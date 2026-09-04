"""
Shared utilities every training script uses to pull real data from
CorverxisONE and report progress back to CorverxisLab. This is what
actually runs inside the training container on AWS/GCP/RunPod — it
reads the same environment variables the connectors
(src/integrations/training/*.js) inject at job submission.
"""
import os
import time
import json
import urllib.request
import urllib.error


def _env(name, required=True, default=None):
    val = os.environ.get(name, default)
    if required and not val:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return val


class CorverxisClient:
    """Thin HTTP client — deliberately stdlib-only (urllib), no requests
    dependency, since the training container should stay minimal and
    every ML framework already pulls in enough of its own weight."""

    def __init__(self):
        self.base_url = _env("CORVERXIS_API_BASE_URL")
        self.training_job_id = _env("CORVERXIS_TRAINING_JOB_ID")
        self.api_key = _env("CORVERXIS_API_KEY")

    def _request(self, method, path, body=None):
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"CorverxisONE API error {e.code} on {method} {path}: {body_text[:300]}") from e

    def fetch_sensor_readings(self, sensor_id, limit=5000):
        """Pulls real SensorReading rows via the existing, already-scoped
        /api/v1/sensors/:id/history endpoint — the ETL step reads from
        the SAME table the gateway agent writes to (see gateway-agent/
        and the ingest bridge in src/routes/lab.js), not a separate copy."""
        return self._request("GET", f"/api/v1/sensors/{sensor_id}/history?points={limit}").get("data", [])

    def fetch_vision_results(self, session_id=None):
        """Pulls real VisionResult rows via /api/v1/vision/sessions —
        same table the vision ingest bridge writes to."""
        sessions = self._request("GET", "/api/v1/vision/sessions").get("data", [])
        if session_id:
            sessions = [s for s in sessions if s.get("id") == session_id]
        return sessions

    def report_progress(self, progress_pct, metrics=None, status="RUNNING"):
        """Writes back to the SAME LabTrainingJob row the Lab UI displays
        — progress reported here shows up live in CorverxisLab without
        any separate sync step."""
        body = {"status": status, "progressPct": progress_pct}
        if metrics is not None:
            body["metrics"] = metrics
        return self._request("PATCH", f"/api/v1/lab/training-jobs/{self.training_job_id}", body)

    def report_complete(self, metrics):
        return self.report_progress(100, metrics=metrics, status="COMPLETED")

    def report_failed(self, error_message):
        return self.report_progress(0, metrics={"error": error_message[:500]}, status="FAILED")


def retry(fn, attempts=3, delay_seconds=5):
    """Training jobs run unattended on rented GPU time — a transient
    network blip reporting progress shouldn't crash an otherwise-healthy
    multi-hour job."""
    last_err = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — deliberately broad, this is a generic retry wrapper
            last_err = e
            if i < attempts - 1:
                time.sleep(delay_seconds)
    raise last_err
