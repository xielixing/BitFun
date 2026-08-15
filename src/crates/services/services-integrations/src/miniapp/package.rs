//! Validation, extraction, and trusted runtime preflight for MiniApp packages.

use bitfun_product_domains::miniapp::distribution::{
    validate_package_manifest, version_satisfies_requirement, MiniAppPackageInspection,
    MiniAppPackageManifest, MiniAppRuntimeDependency, MiniAppRuntimeDependencyStatus,
    MINIAPP_PACKAGE_MANIFEST,
};
use bitfun_product_domains::miniapp::types::MiniAppMeta;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tempfile::TempDir;
use tokio::process::Command;
use zip::ZipArchive;

const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 96 * 1024 * 1024;
const MAX_FILE_COUNT: usize = 512;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const RUNTIME_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct ExtractedMiniAppPackage {
    pub manifest: MiniAppPackageManifest,
    pub app: MiniAppMeta,
    temp_dir: TempDir,
}

impl ExtractedMiniAppPackage {
    pub fn root(&self) -> &Path {
        self.temp_dir.path()
    }
}

pub fn validate_and_extract_package(
    package_path: impl AsRef<Path>,
) -> Result<ExtractedMiniAppPackage, String> {
    let package_path = package_path.as_ref();
    let metadata = std::fs::metadata(package_path)
        .map_err(|error| format!("Failed to read MiniApp package metadata: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "MiniApp package is not a file: {}",
            package_path.display()
        ));
    }
    if metadata.len() > MAX_PACKAGE_BYTES {
        return Err(format!(
            "MiniApp package exceeds the {} MiB size limit",
            MAX_PACKAGE_BYTES / 1024 / 1024
        ));
    }

    let file = File::open(package_path)
        .map_err(|error| format!("Failed to open MiniApp package: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Invalid MiniApp package ZIP: {error}"))?;
    if archive.len() == 0 || archive.len() > MAX_FILE_COUNT + 1 {
        return Err(format!(
            "MiniApp package contains an invalid number of files: {}",
            archive.len()
        ));
    }

    let mut files = BTreeMap::<String, Vec<u8>>::new();
    let mut expanded_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read MiniApp package entry: {error}"))?;
        if !entry.is_file() || entry.is_symlink() {
            return Err(format!(
                "MiniApp package contains a non-regular file: {}",
                entry.name()
            ));
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("MiniApp package contains an unsafe path: {}", entry.name()))?;
        let path = enclosed
            .to_str()
            .ok_or_else(|| "MiniApp package paths must be UTF-8".to_string())?
            .replace('\\', "/");
        if path != entry.name() {
            return Err(format!(
                "MiniApp package contains a non-canonical path: {path}"
            ));
        }
        if files.contains_key(&path) {
            return Err(format!("MiniApp package contains a duplicate file: {path}"));
        }
        let expected_size = entry.size();
        expanded_bytes = expanded_bytes
            .checked_add(expected_size)
            .ok_or_else(|| "MiniApp package expanded size overflow".to_string())?;
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err(format!(
                "MiniApp package exceeds the {} MiB expanded size limit",
                MAX_EXPANDED_BYTES / 1024 / 1024
            ));
        }
        let remaining_limit =
            MAX_EXPANDED_BYTES.saturating_sub(expanded_bytes.saturating_sub(expected_size));
        let mut bytes = Vec::with_capacity(expected_size.min(usize::MAX as u64) as usize);
        (&mut entry)
            .take(expected_size.min(remaining_limit).saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Failed to read MiniApp package file '{path}': {error}"))?;
        if bytes.len() as u64 != expected_size {
            return Err(format!(
                "MiniApp package file size does not match its ZIP metadata: {path}"
            ));
        }
        files.insert(path, bytes);
    }

    let manifest_bytes = files
        .remove(MINIAPP_PACKAGE_MANIFEST)
        .ok_or_else(|| format!("MiniApp package is missing {MINIAPP_PACKAGE_MANIFEST}"))?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err("MiniApp package manifest is too large".to_string());
    }
    let manifest: MiniAppPackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("Invalid MiniApp package manifest: {error}"))?;
    validate_package_manifest(&manifest)?;

    let declared: BTreeSet<_> = manifest.files.keys().cloned().collect();
    let actual: BTreeSet<_> = files.keys().cloned().collect();
    if declared != actual {
        let undeclared: Vec<_> = actual.difference(&declared).cloned().collect();
        let missing: Vec<_> = declared.difference(&actual).cloned().collect();
        return Err(format!(
            "MiniApp package file list mismatch (undeclared: {}; missing: {})",
            undeclared.join(", "),
            missing.join(", ")
        ));
    }

    for (path, expected_hash) in &manifest.files {
        let bytes = files
            .get(path)
            .ok_or_else(|| format!("MiniApp package is missing declared file: {path}"))?;
        let actual_hash = format!("sha256:{:x}", Sha256::digest(bytes));
        if !actual_hash.eq_ignore_ascii_case(expected_hash) {
            return Err(format!("MiniApp package hash mismatch: {path}"));
        }
    }

    let app: MiniAppMeta = serde_json::from_slice(
        files
            .get("meta.json")
            .ok_or_else(|| "MiniApp package is missing meta.json".to_string())?,
    )
    .map_err(|error| format!("Invalid packaged meta.json: {error}"))?;

    let temp_dir = tempfile::Builder::new()
        .prefix("bitfun-miniapp-package-")
        .tempdir()
        .map_err(|error| format!("Failed to create MiniApp package staging directory: {error}"))?;
    for (path, bytes) in files {
        let destination = temp_dir.path().join(&path);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Failed to create MiniApp package staging directory: {error}")
            })?;
        }
        let mut output = File::create(&destination)
            .map_err(|error| format!("Failed to create staged MiniApp file '{path}': {error}"))?;
        output
            .write_all(&bytes)
            .map_err(|error| format!("Failed to write staged MiniApp file '{path}': {error}"))?;
    }

    Ok(ExtractedMiniAppPackage {
        manifest,
        app,
        temp_dir,
    })
}

pub async fn inspect_package(
    package_path: impl AsRef<Path>,
) -> Result<MiniAppPackageInspection, String> {
    let package_path = package_path.as_ref().to_path_buf();
    let extracted = tokio::task::spawn_blocking(move || validate_and_extract_package(package_path))
        .await
        .map_err(|error| format!("MiniApp package validation task failed: {error}"))??;
    let runtime_dependencies =
        inspect_runtime_dependencies(&extracted.manifest.runtime_dependencies).await;
    Ok(MiniAppPackageInspection {
        manifest: extracted.manifest,
        app: extracted.app,
        runtime_dependencies,
    })
}

pub async fn inspect_runtime_dependencies(
    dependencies: &[MiniAppRuntimeDependency],
) -> Vec<MiniAppRuntimeDependencyStatus> {
    let mut statuses = Vec::with_capacity(dependencies.len());
    for dependency in dependencies {
        statuses.push(inspect_runtime_dependency(dependency).await);
    }
    statuses
}

async fn inspect_runtime_dependency(
    dependency: &MiniAppRuntimeDependency,
) -> MiniAppRuntimeDependencyStatus {
    if dependency.id != "org.loopx.cli" {
        return MiniAppRuntimeDependencyStatus {
            id: dependency.id.clone(),
            requirement: dependency.version.clone(),
            detected_version: None,
            satisfied: false,
            message: "This BitFun version does not recognize the requested runtime".to_string(),
        };
    }

    let candidates: &[(&str, &[&str])] = &[
        ("loopx", &["--version"]),
        ("python", &["-m", "loopx.cli", "--version"]),
        ("py", &["-3", "-m", "loopx.cli", "--version"]),
    ];
    for (program, args) in candidates {
        let mut command = Command::new(program);
        command
            .args(*args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_hidden_process(&mut command);
        let Ok(result) = tokio::time::timeout(RUNTIME_PROBE_TIMEOUT, command.output()).await else {
            continue;
        };
        let Ok(output) = result else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let satisfied = version_satisfies_requirement(&version, &dependency.version);
        return MiniAppRuntimeDependencyStatus {
            id: dependency.id.clone(),
            requirement: dependency.version.clone(),
            detected_version: Some(version.clone()),
            satisfied,
            message: if satisfied {
                "Runtime dependency is available".to_string()
            } else {
                format!("Detected runtime does not satisfy {}", dependency.version)
            },
        };
    }

    MiniAppRuntimeDependencyStatus {
        id: dependency.id.clone(),
        requirement: dependency.version.clone(),
        detected_version: None,
        satisfied: false,
        message: "LoopX CLI is not installed or not available on PATH".to_string(),
    }
}

#[cfg(windows)]
fn configure_hidden_process(command: &mut Command) {
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn configure_hidden_process(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_product_domains::miniapp::distribution::{
        MiniAppPublisher, MINIAPP_PACKAGE_SCHEMA_VERSION,
    };
    use zip::write::SimpleFileOptions;

    fn package_files() -> BTreeMap<String, Vec<u8>> {
        BTreeMap::from([
            ("meta.json".to_string(), br#"{"id":"demo","name":"Demo","description":"Demo","icon":"box","category":"tools","tags":[],"version":1,"created_at":0,"updated_at":0,"permissions":{}}"#.to_vec()),
            ("package.json".to_string(), br#"{"private":true}"#.to_vec()),
            ("source/index.html".to_string(), b"<main></main>".to_vec()),
            ("source/style.css".to_string(), b"body {}".to_vec()),
            ("source/ui.js".to_string(), b"".to_vec()),
            ("source/worker.js".to_string(), b"".to_vec()),
            ("source/esm_dependencies.json".to_string(), b"[]".to_vec()),
        ])
    }

    fn write_package(path: &Path, files: &BTreeMap<String, Vec<u8>>, extra: Option<(&str, &[u8])>) {
        write_package_with_contents(path, files, files, extra);
    }

    fn write_package_with_contents(
        path: &Path,
        manifest_files: &BTreeMap<String, Vec<u8>>,
        archive_files: &BTreeMap<String, Vec<u8>>,
        extra: Option<(&str, &[u8])>,
    ) {
        let manifest = MiniAppPackageManifest {
            schema_version: MINIAPP_PACKAGE_SCHEMA_VERSION,
            package_id: "org.example.demo".to_string(),
            version: "1.0.0".to_string(),
            publisher: MiniAppPublisher {
                id: "org.example".to_string(),
                name: "Example".to_string(),
            },
            min_bitfun_version: "0.2.13".to_string(),
            runtime_dependencies: Vec::new(),
            files: manifest_files
                .iter()
                .map(|(path, bytes)| (path.clone(), format!("sha256:{:x}", Sha256::digest(bytes))))
                .collect(),
        };
        let output = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(output);
        let options = SimpleFileOptions::default();
        writer
            .start_file(MINIAPP_PACKAGE_MANIFEST, options)
            .unwrap();
        writer
            .write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        for (path, bytes) in archive_files {
            writer.start_file(path, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        if let Some((path, bytes)) = extra {
            writer.start_file(path, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn validates_and_extracts_a_complete_package() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("demo.bitfun-miniapp");
        write_package(&path, &package_files(), None);

        let package = validate_and_extract_package(&path).unwrap();
        assert_eq!(package.manifest.package_id, "org.example.demo");
        assert_eq!(package.app.name, "Demo");
        assert!(package.root().join("source/ui.js").is_file());
        assert!(!package.root().join("storage.json").exists());
    }

    #[test]
    fn rejects_undeclared_and_hash_mismatched_files() {
        let temp = tempfile::tempdir().unwrap();
        let extra_path = temp.path().join("extra.bitfun-miniapp");
        write_package(&extra_path, &package_files(), Some(("extra.txt", b"no")));
        assert!(validate_and_extract_package(&extra_path)
            .unwrap_err()
            .contains("file list mismatch"));

        let mut changed = package_files();
        let original = changed.clone();
        changed.insert("source/ui.js".to_string(), b"changed".to_vec());
        let changed_path = temp.path().join("changed.bitfun-miniapp");
        write_package_with_contents(&changed_path, &original, &changed, None);
        assert!(validate_and_extract_package(&changed_path)
            .unwrap_err()
            .contains("hash mismatch"));
    }

    #[test]
    fn rejects_path_traversal_and_packaged_user_data() {
        let temp = tempfile::tempdir().unwrap();
        let traversal_path = temp.path().join("traversal.bitfun-miniapp");
        write_package(
            &traversal_path,
            &package_files(),
            Some(("../escape", b"no")),
        );
        assert!(validate_and_extract_package(&traversal_path)
            .unwrap_err()
            .contains("unsafe path"));

        let storage_path = temp.path().join("storage.bitfun-miniapp");
        write_package(
            &storage_path,
            &package_files(),
            Some(("storage.json", b"{}")),
        );
        assert!(validate_and_extract_package(&storage_path).is_err());
    }
}
