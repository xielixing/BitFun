//! Installable MiniApp package contracts and pure validation.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::types::MiniAppMeta;

pub const MINIAPP_PACKAGE_MANIFEST: &str = "bitfun-miniapp.json";
pub const MINIAPP_PACKAGE_EXTENSION: &str = "bitfun-miniapp";
pub const MINIAPP_PACKAGE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppPublisher {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppRuntimeDependency {
    pub id: String,
    pub version: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppDistributionIdentity {
    pub package_id: String,
    pub package_version: String,
    pub publisher_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiniAppRuntimeDependencyStatus {
    pub id: String,
    pub requirement: String,
    pub detected_version: Option<String>,
    pub satisfied: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniAppPackageInspection {
    pub manifest: MiniAppPackageManifest,
    pub app: MiniAppMeta,
    pub runtime_dependencies: Vec<MiniAppRuntimeDependencyStatus>,
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
        if !runtime.version.starts_with(">=") {
            return Err(format!(
                "Runtime dependency '{}' must use a >= version requirement",
                runtime.id
            ));
        }
        validate_version(
            "runtime dependency version",
            runtime.version.trim_start_matches(">="),
        )?;
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

pub fn version_satisfies_requirement(current: &str, requirement: &str) -> bool {
    let Some(required) = requirement.strip_prefix(">=") else {
        return false;
    };
    match (version_parts(current), version_parts(required)) {
        (Some(current), Some(required)) => current >= required,
        _ => false,
    }
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
    version_parts(value)
        .map(|_| ())
        .ok_or_else(|| format!("Invalid {label}: {value}"))
}

fn version_parts(value: &str) -> Option<(u64, u64, u64)> {
    let token = value
        .split_whitespace()
        .find(|token| token.chars().next().is_some_and(|ch| ch.is_ascii_digit()))?
        .split(['-', '+'])
        .next()?;
    let mut parts = token.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_manifest_rejects_user_data_and_accepts_runtime_requirement() {
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
        let mut manifest = MiniAppPackageManifest {
            schema_version: 1,
            package_id: "org.loopx.console".to_string(),
            version: "3.0.0".to_string(),
            publisher: MiniAppPublisher {
                id: "org.loopx".to_string(),
                name: "LoopX contributors".to_string(),
            },
            min_bitfun_version: "0.2.13".to_string(),
            runtime_dependencies: vec![MiniAppRuntimeDependency {
                id: "org.loopx.cli".to_string(),
                version: ">=0.2.13".to_string(),
            }],
            files,
        };

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
    fn runtime_versions_compare_numeric_components() {
        assert!(version_satisfies_requirement("loopx 0.2.13", ">=0.2.13"));
        assert!(version_satisfies_requirement("0.3.0", ">=0.2.13"));
        assert!(!version_satisfies_requirement("0.2.12", ">=0.2.13"));
    }
}
