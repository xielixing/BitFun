//! Installable MiniApp package contracts and pure validation.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::types::MiniAppMeta;

pub const MINIAPP_PACKAGE_MANIFEST: &str = "bitfun-miniapp.json";
pub const MINIAPP_PACKAGE_EXTENSION: &str = "bitfun-miniapp";
pub const MINIAPP_PACKAGE_SCHEMA_VERSION: u32 = 1;

const MAX_PROBE_COMMANDS: usize = 8;
const MAX_PROBE_ARGS: usize = 16;
const MAX_PROBE_TOKEN_CHARS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppPublisher {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppPackageManifest {
    pub schema_version: u32,
    pub package_id: String,
    pub version: String,
    pub publisher: MiniAppPublisher,
    pub min_bitfun_version: String,
    #[serde(default)]
    pub runtime_dependencies: Vec<MiniAppRuntimeDependency>,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
}

/// Declarative runtime detection: the host runs these command lines in order
/// and treats the first successful run (exit code 0) as the detected runtime.
/// Programs are spawned directly (no shell), so no shell interpolation happens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppRuntimeProbe {
    pub commands: Vec<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppRuntimeDependency {
    pub id: String,
    /// Human-readable name shown in install confirmation (e.g. "LoopX CLI").
    #[serde(default)]
    pub label: String,
    /// Version requirement: a comma-separated conjunction of constraints such
    /// as `>=0.2.13`, `=0.4.4`, or `>=0.2.13,<0.4.5`; a bare version means exact.
    pub version: String,
    #[serde(default)]
    pub probe: Option<MiniAppRuntimeProbe>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppDistributionIdentity {
    pub package_id: String,
    pub package_version: String,
    pub publisher_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniAppRuntimeDependencyStatus {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub requirement: String,
    pub detected_version: Option<String>,
    pub satisfied: bool,
    pub message: String,
    /// Command lines the host ran (or would have run) to detect this runtime.
    #[serde(default)]
    pub probe_commands: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniAppPackageInspection {
    pub manifest: MiniAppPackageManifest,
    pub app: MiniAppMeta,
    pub runtime_dependencies: Vec<MiniAppRuntimeDependencyStatus>,
}

/// Install decision against the already-installed distribution identities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MiniAppInstallDecision {
    /// No installed app shares this package identity.
    Fresh,
    /// A different version of the same package is installed; installation
    /// proceeds as a new instance alongside the existing ones.
    NewVersion { installed_versions: Vec<String> },
    /// This exact package version is already installed.
    DuplicateVersion,
}

impl From<&MiniAppPackageManifest> for MiniAppDistributionIdentity {
    fn from(manifest: &MiniAppPackageManifest) -> Self {
        Self {
            package_id: manifest.package_id.clone(),
            package_version: manifest.version.clone(),
            publisher_id: manifest.publisher.id.clone(),
        }
    }
}

pub fn validate_package_manifest(manifest: &MiniAppPackageManifest) -> Result<(), String> {
    if manifest.schema_version != MINIAPP_PACKAGE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported MiniApp package schema version: {}",
            manifest.schema_version
        ));
    }
    validate_identifier("package_id", &manifest.package_id)?;
    validate_identifier("publisher.id", &manifest.publisher.id)?;
    if manifest.publisher.name.trim().is_empty() {
        return Err("publisher.name must not be empty".to_string());
    }
    validate_version("version", &manifest.version)?;
    validate_version("min_bitfun_version", &manifest.min_bitfun_version)?;

    for required in [
        "meta.json",
        "package.json",
        "source/index.html",
        "source/style.css",
        "source/ui.js",
        "source/worker.js",
        "source/esm_dependencies.json",
    ] {
        if !manifest.files.contains_key(required) {
            return Err(format!(
                "MiniApp package is missing required file: {required}"
            ));
        }
    }

    for (path, hash) in &manifest.files {
        validate_package_path(path)?;
        if !is_sha256(hash) {
            return Err(format!("Invalid SHA-256 for package file: {path}"));
        }
    }

    for runtime in &manifest.runtime_dependencies {
        validate_identifier("runtime dependency id", &runtime.id)?;
        parse_version_requirement(&runtime.version)
            .map_err(|error| format!("runtime dependency '{}' {error}", runtime.id))?;
        let probe = runtime.probe.as_ref().ok_or_else(|| {
            format!(
                "runtime dependency '{}' must declare probe commands",
                runtime.id
            )
        })?;
        validate_probe_commands(&runtime.id, &probe.commands)?;
    }
    Ok(())
}

pub fn validate_package_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("Invalid MiniApp package path: {path}"));
    }
    if matches!(path, "compiled.html" | "storage.json")
        || path.starts_with("versions/")
        || path.starts_with(".drafts/")
    {
        return Err(format!("Runtime or user data must not be packaged: {path}"));
    }
    Ok(())
}

/// Decide whether a package may be installed next to the given installed
/// distribution identities.
pub fn decide_install(
    existing: &[MiniAppDistributionIdentity],
    manifest: &MiniAppPackageManifest,
) -> MiniAppInstallDecision {
    let identity = MiniAppDistributionIdentity::from(manifest);
    let mut installed_versions: Vec<String> = existing
        .iter()
        .filter(|installed| installed.package_id == identity.package_id)
        .map(|installed| installed.package_version.clone())
        .collect();
    if installed_versions.is_empty() {
        return MiniAppInstallDecision::Fresh;
    }
    installed_versions.sort();
    installed_versions.dedup();
    if installed_versions.contains(&identity.package_version) {
        MiniAppInstallDecision::DuplicateVersion
    } else {
        MiniAppInstallDecision::NewVersion { installed_versions }
    }
}

// --- Version requirements -------------------------------------------------

type VersionNumber = (u64, u64, u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionOp {
    AtLeast,
    Greater,
    Exact,
    AtMost,
    Less,
}

fn parse_version_number(value: &str) -> Result<VersionNumber, String> {
    let mut parts = value.split('.');
    let major = parts
        .next()
        .unwrap_or_default()
        .parse()
        .map_err(|_| format!("invalid version: {value}"))?;
    let minor = parts
        .next()
        .unwrap_or("0")
        .parse()
        .map_err(|_| format!("invalid version: {value}"))?;
    let patch = parts
        .next()
        .unwrap_or("0")
        .parse()
        .map_err(|_| format!("invalid version: {value}"))?;
    Ok((major, minor, patch))
}

/// Extract a numeric version from a probe output line such as `loopx 0.4.6`,
/// `0.4.6`, or `v22.12.0` (first whitespace-separated token containing a
/// digit, leading non-digits stripped, pre-release/build suffixes dropped).
fn extract_version_number(output: &str) -> Option<VersionNumber> {
    let token = output
        .split_whitespace()
        .find(|token| token.chars().any(|ch| ch.is_ascii_digit()))?;
    let numeric = token.trim_start_matches(|ch: char| !ch.is_ascii_digit());
    let core = numeric.split(['-', '+']).next()?;
    parse_version_number(core).ok()
}

fn parse_version_requirement(requirement: &str) -> Result<Vec<(VersionOp, VersionNumber)>, String> {
    let trimmed = requirement.trim();
    if trimmed.is_empty() {
        return Err("version requirement must not be empty".to_string());
    }
    let mut constraints = Vec::new();
    for part in trimmed.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err("version requirement contains an empty constraint".to_string());
        }
        let (op, version) = if let Some(rest) = part.strip_prefix(">=") {
            (VersionOp::AtLeast, rest)
        } else if let Some(rest) = part.strip_prefix("<=") {
            (VersionOp::AtMost, rest)
        } else if let Some(rest) = part.strip_prefix('>') {
            (VersionOp::Greater, rest)
        } else if let Some(rest) = part.strip_prefix('<') {
            (VersionOp::Less, rest)
        } else if let Some(rest) = part.strip_prefix('=') {
            (VersionOp::Exact, rest)
        } else {
            (VersionOp::Exact, part)
        };
        let version = version.trim();
        if version.is_empty() {
            return Err("version requirement constraint has no version".to_string());
        }
        constraints.push((op, parse_version_number(version)?));
    }
    Ok(constraints)
}

pub fn version_satisfies_requirement(current: &str, requirement: &str) -> bool {
    let Ok(constraints) = parse_version_requirement(requirement) else {
        return false;
    };
    let Some(current) = extract_version_number(current) else {
        return false;
    };
    constraints.iter().all(|(op, required)| match op {
        VersionOp::AtLeast => current >= *required,
        VersionOp::Greater => current > *required,
        VersionOp::Exact => current == *required,
        VersionOp::AtMost => current <= *required,
        VersionOp::Less => current < *required,
    })
}

fn validate_probe_commands(dependency_id: &str, commands: &[Vec<String>]) -> Result<(), String> {
    if commands.is_empty() || commands.len() > MAX_PROBE_COMMANDS {
        return Err(format!(
            "runtime dependency '{dependency_id}' probe must declare 1-{} command candidates",
            MAX_PROBE_COMMANDS
        ));
    }
    for command in commands {
        if command.is_empty() || command.len() > MAX_PROBE_ARGS {
            return Err(format!(
                "runtime dependency '{dependency_id}' probe commands must contain 1-{} arguments",
                MAX_PROBE_ARGS
            ));
        }
        for token in command {
            if token.is_empty() || token.len() > MAX_PROBE_TOKEN_CHARS {
                return Err(format!(
                    "runtime dependency '{dependency_id}' probe arguments must be 1-{} characters",
                    MAX_PROBE_TOKEN_CHARS
                ));
            }
        }
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    valid
        .then_some(())
        .ok_or_else(|| format!("Invalid {label}: {value}"))
}

fn validate_version(label: &str, value: &str) -> Result<(), String> {
    parse_version_number(value)
        .map(|_| ())
        .map_err(|_| format!("Invalid {label}: {value}"))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_dependency() -> MiniAppRuntimeDependency {
        MiniAppRuntimeDependency {
            id: "org.loopx.cli".to_string(),
            label: "LoopX CLI".to_string(),
            version: ">=0.2.13".to_string(),
            probe: Some(MiniAppRuntimeProbe {
                commands: vec![
                    vec!["loopx".to_string(), "--version".to_string()],
                    vec![
                        "python".to_string(),
                        "-m".to_string(),
                        "loopx.cli".to_string(),
                        "--version".to_string(),
                    ],
                ],
            }),
        }
    }

    fn manifest() -> MiniAppPackageManifest {
        let mut files = BTreeMap::new();
        for path in [
            "meta.json",
            "package.json",
            "source/index.html",
            "source/style.css",
            "source/ui.js",
            "source/worker.js",
            "source/esm_dependencies.json",
        ] {
            files.insert(path.to_string(), format!("sha256:{}", "a".repeat(64)));
        }
        MiniAppPackageManifest {
            schema_version: 1,
            package_id: "org.loopx.console".to_string(),
            version: "3.0.0".to_string(),
            publisher: MiniAppPublisher {
                id: "org.loopx".to_string(),
                name: "LoopX contributors".to_string(),
            },
            min_bitfun_version: "0.2.13".to_string(),
            runtime_dependencies: vec![runtime_dependency()],
            files,
        }
    }

    #[test]
    fn package_manifest_rejects_user_data_and_accepts_runtime_requirement() {
        let mut manifest = manifest();
        assert!(validate_package_manifest(&manifest).is_ok());
        manifest.files.insert(
            "storage.json".to_string(),
            format!("sha256:{}", "b".repeat(64)),
        );
        assert!(validate_package_manifest(&manifest)
            .unwrap_err()
            .contains("must not be packaged"));
    }

    #[test]
    fn runtime_dependency_requires_declarative_probe_commands() {
        let mut missing_probe = manifest();
        missing_probe.runtime_dependencies[0].probe = None;
        assert!(validate_package_manifest(&missing_probe)
            .unwrap_err()
            .contains("must declare probe commands"));

        let mut bad_requirement = manifest();
        bad_requirement.runtime_dependencies[0].version = "^0.4.4".to_string();
        assert!(validate_package_manifest(&bad_requirement).is_err());

        let mut too_many_commands = manifest();
        too_many_commands.runtime_dependencies[0].probe = Some(MiniAppRuntimeProbe {
            commands: (0..=MAX_PROBE_COMMANDS)
                .map(|_| vec!["loopx".to_string(), "--version".to_string()])
                .collect(),
        });
        assert!(validate_package_manifest(&too_many_commands)
            .unwrap_err()
            .contains("command candidates"));
    }

    #[test]
    fn version_requirement_accepts_operators_ranges_and_version_prefixed_output() {
        assert!(version_satisfies_requirement("loopx 0.2.13", ">=0.2.13"));
        assert!(version_satisfies_requirement("0.3.0", ">=0.2.13"));
        assert!(!version_satisfies_requirement("0.2.12", ">=0.2.13"));

        assert!(version_satisfies_requirement("loopx 0.4.4", "=0.4.4"));
        assert!(!version_satisfies_requirement("loopx 0.4.6", "=0.4.4"));
        assert!(version_satisfies_requirement("loopx 0.4.4", "0.4.4"));

        assert!(version_satisfies_requirement(
            "loopx 0.4.4",
            ">=0.2.13,<0.4.5"
        ));
        assert!(!version_satisfies_requirement(
            "loopx 0.4.5",
            ">=0.2.13,<0.4.5"
        ));
        assert!(version_satisfies_requirement(
            "loopx 0.2.13",
            ">=0.2.13,<0.4.5"
        ));

        assert!(version_satisfies_requirement("v22.12.0", ">=0.0.0"));
        assert!(version_satisfies_requirement(
            "loopx 0.4.6+build1",
            ">=0.4.6"
        ));
        assert!(!version_satisfies_requirement("loopx", ">=0.2.13"));
        assert!(!version_satisfies_requirement("0.4.4", ">=0.2.13,<"));
    }

    #[test]
    fn install_decision_distinguishes_fresh_new_version_and_duplicate() {
        let manifest = manifest();
        let identity = |package_id: &str, version: &str| MiniAppDistributionIdentity {
            package_id: package_id.to_string(),
            package_version: version.to_string(),
            publisher_id: "org.loopx".to_string(),
        };

        assert_eq!(
            decide_install(&[], &manifest),
            MiniAppInstallDecision::Fresh
        );
        assert_eq!(
            decide_install(&[identity("org.other.app", "1.0.0")], &manifest),
            MiniAppInstallDecision::Fresh
        );
        assert_eq!(
            decide_install(&[identity("org.loopx.console", "2.0.0")], &manifest),
            MiniAppInstallDecision::NewVersion {
                installed_versions: vec!["2.0.0".to_string()]
            }
        );
        assert_eq!(
            decide_install(
                &[
                    identity("org.loopx.console", "1.0.0"),
                    identity("org.loopx.console", "3.0.0"),
                    identity("org.other.app", "9.9.9"),
                ],
                &manifest
            ),
            MiniAppInstallDecision::DuplicateVersion
        );
    }
}
