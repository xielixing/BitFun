//! JS Worker — single child process (Bun/Node) with stdin/stderr JSON-RPC.
//!
//! Concurrency model: `call` takes `&self` and locks stdin only while writing
//! the request line; responses are routed by id through the `pending` map, so
//! multiple RPCs on the same worker proceed independently. An in-flight
//! counter marks the worker busy — the pool must never idle-reap or LRU-evict
//! a worker with pending RPCs, since `last_activity` alone goes stale during
//! long calls that emit no stderr output.

use bitfun_product_domains::miniapp::runtime::DetectedRuntime;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

type JsWorkerResponse = Result<Value, String>;
type PendingResponseSender = oneshot::Sender<JsWorkerResponse>;
type PendingResponseMap = HashMap<String, PendingResponseSender>;
pub type MiniAppWorkerEventFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

#[derive(Debug, Clone)]
pub struct MiniAppWorkerEvent {
    pub app_id: String,
    pub event: String,
    pub data: Value,
}

pub trait MiniAppWorkerEventSink: Send + Sync {
    fn emit_worker_event<'a>(&'a self, event: MiniAppWorkerEvent) -> MiniAppWorkerEventFuture<'a>;
}

pub type SharedMiniAppWorkerEventSink = Arc<dyn MiniAppWorkerEventSink>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn lock_pending(pending: &StdMutex<PendingResponseMap>) -> MutexGuard<'_, PendingResponseMap> {
    pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Removes the pending entry and drops the busy mark on every exit path of
/// `call`, including timeout and caller cancellation.
struct InflightGuard {
    id: String,
    pending: Arc<StdMutex<PendingResponseMap>>,
    inflight: Arc<AtomicUsize>,
    last_activity: Arc<AtomicI64>,
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        lock_pending(&self.pending).remove(&self.id);
        self.inflight.fetch_sub(1, Ordering::SeqCst);
        self.last_activity.store(now_ms(), Ordering::SeqCst);
    }
}

/// Single JS Worker process: stdin for requests, stderr for RPC responses, stdout for user logs.
pub struct JsWorker {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Arc<StdMutex<PendingResponseMap>>,
    last_activity: Arc<AtomicI64>,
    inflight: Arc<AtomicUsize>,
}

impl JsWorker {
    /// Spawn Worker process: `runtime_path worker_host_path '<policy_json>'` with cwd = app_dir.
    /// The `app_id` is used as the source identifier when emitting worker events.
    pub async fn spawn(
        runtime: &DetectedRuntime,
        worker_host_path: &Path,
        app_dir: &Path,
        policy_json: &str,
        app_id: String,
        event_sink: Option<SharedMiniAppWorkerEventSink>,
    ) -> Result<Self, String> {
        let exe = runtime.path.to_string_lossy();
        let host = worker_host_path.to_string_lossy();
        let mut child = bitfun_services_core::process_manager::create_tokio_command(&*exe)
            .arg(&*host)
            .arg(policy_json)
            .current_dir(app_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn JS Worker: {}", e))?;

        let stdin_handle = child.stdin.take().ok_or("No stdin")?;
        let stderr = child.stderr.take().ok_or("No stderr")?;
        let _stdout = child.stdout.take();

        let pending = Arc::new(StdMutex::new(PendingResponseMap::new()));
        let last_activity = Arc::new(AtomicI64::new(now_ms()));

        let pending_clone = pending.clone();
        let last_activity_clone = last_activity.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.is_empty() {
                    continue;
                }
                last_activity_clone.store(now_ms(), Ordering::SeqCst);
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Lines with an `id` are RPC responses — route to the pending map.
                let id = msg.get("id").and_then(Value::as_str).map(String::from);
                if let Some(id) = id {
                    let result = if let Some(err) = msg.get("error") {
                        let msg = err
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("RPC error");
                        Err(msg.to_string())
                    } else {
                        msg.get("result")
                            .cloned()
                            .ok_or_else(|| "Missing result".to_string())
                    };
                    let tx = lock_pending(&pending_clone).remove(&id);
                    if let Some(tx) = tx {
                        let _ = tx.send(result);
                    }
                    continue;
                }

                // Lines with an `event` field (no `id`) are push events from the Worker.
                if let Some(event_name) = msg.get("event").and_then(Value::as_str) {
                    let Some(sink) = event_sink.as_ref() else {
                        continue;
                    };
                    let data = msg.get("data").cloned().unwrap_or(Value::Null);
                    sink.emit_worker_event(MiniAppWorkerEvent {
                        app_id: app_id.clone(),
                        event: event_name.to_string(),
                        data,
                    })
                    .await;
                }
            }

            // stderr EOF: the process died — fail all in-flight calls now
            // instead of letting each caller run out its own timeout.
            let waiters: Vec<PendingResponseSender> = {
                let mut guard = lock_pending(&pending_clone);
                guard.drain().map(|(_, tx)| tx).collect()
            };
            for tx in waiters {
                let _ = tx.send(Err("Worker exited".to_string()));
            }
        });

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(Some(stdin_handle)),
            pending,
            last_activity,
            inflight: Arc::new(AtomicUsize::new(0)),
        })
    }

    /// Send a JSON-RPC request and wait for the response (with timeout).
    /// Concurrent calls interleave: the stdin lock covers only the write.
    pub async fn call(
        &self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let id = format!("rpc-{}", uuid::Uuid::new_v4());
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())? + "\n";

        let (tx, rx) = oneshot::channel();
        self.inflight.fetch_add(1, Ordering::SeqCst);
        let _inflight = InflightGuard {
            id: id.clone(),
            pending: Arc::clone(&self.pending),
            inflight: Arc::clone(&self.inflight),
            last_activity: Arc::clone(&self.last_activity),
        };
        lock_pending(&self.pending).insert(id, tx);
        self.last_activity.store(now_ms(), Ordering::SeqCst);

        {
            let mut stdin_guard = self.stdin.lock().await;
            let stdin = stdin_guard.as_mut().ok_or("Worker stdin closed")?;
            use tokio::io::AsyncWriteExt;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
        }

        let timeout = Duration::from_millis(timeout_ms);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(e),
            Ok(Err(_)) => Err("Worker dropped response".to_string()),
            Err(_) => Err(format!("Worker call timeout ({}ms)", timeout_ms)),
        }
    }

    /// Last activity timestamp (millis since epoch). Refreshed on request
    /// send, on every stderr line, and when an in-flight call settles.
    pub fn last_activity_ms(&self) -> i64 {
        self.last_activity.load(Ordering::SeqCst)
    }

    /// Number of RPCs currently awaiting a response.
    pub fn inflight_count(&self) -> usize {
        self.inflight.load(Ordering::SeqCst)
    }

    /// True while any RPC is in flight. Busy workers must not be reaped or
    /// evicted: `last_activity` alone can look stale during a long quiet call.
    pub fn is_busy(&self) -> bool {
        self.inflight_count() > 0
    }

    /// Kill the worker process. Safe to call while RPCs are in flight — the
    /// stderr reader fails them with "Worker exited" once the process dies.
    pub async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inflight_guard_settles_call_state_on_drop() {
        let pending: Arc<StdMutex<PendingResponseMap>> =
            Arc::new(StdMutex::new(PendingResponseMap::new()));
        let inflight = Arc::new(AtomicUsize::new(1));
        let last_activity = Arc::new(AtomicI64::new(0));

        let (tx, mut rx) = oneshot::channel();
        lock_pending(&pending).insert("rpc-1".to_string(), tx);

        drop(InflightGuard {
            id: "rpc-1".to_string(),
            pending: Arc::clone(&pending),
            inflight: Arc::clone(&inflight),
            last_activity: Arc::clone(&last_activity),
        });

        assert!(lock_pending(&pending).is_empty());
        assert_eq!(inflight.load(Ordering::SeqCst), 0);
        assert!(last_activity.load(Ordering::SeqCst) > 0);
        // The sender side is gone, so a late response would be dropped.
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn inflight_guard_leaves_other_pending_calls_untouched() {
        let pending: Arc<StdMutex<PendingResponseMap>> =
            Arc::new(StdMutex::new(PendingResponseMap::new()));
        let inflight = Arc::new(AtomicUsize::new(2));
        let last_activity = Arc::new(AtomicI64::new(0));

        let (tx1, _rx1) = oneshot::channel();
        let (tx2, _rx2) = oneshot::channel();
        lock_pending(&pending).insert("rpc-1".to_string(), tx1);
        lock_pending(&pending).insert("rpc-2".to_string(), tx2);

        drop(InflightGuard {
            id: "rpc-1".to_string(),
            pending: Arc::clone(&pending),
            inflight: Arc::clone(&inflight),
            last_activity: Arc::clone(&last_activity),
        });

        let guard = lock_pending(&pending);
        assert_eq!(guard.len(), 1);
        assert!(guard.contains_key("rpc-2"));
        assert_eq!(inflight.load(Ordering::SeqCst), 1);
    }
}
