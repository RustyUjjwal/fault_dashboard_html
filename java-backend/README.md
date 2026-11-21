# Java 11+ Standalone Backend (`FaultAnalyzerServer.java`)

This folder provides a zero-dependency Java backend using `com.sun.net.httpserver.HttpServer` and `java.net.http.HttpClient` that serves the pure HTML, CSS, and Vanilla JavaScript frontend directly and implements the exact same REST API contract:

- `GET  /api/health`
- `GET  /api/models`
- `GET  /api/taxonomy` (28-class `fault_type_table.m` catalog)
- `GET  /api/samples`
- `GET  /api/samples/{id}/analyze`
- `GET  /api/samples/{id}/csv`
- `POST /api/analyze` (multipart CSV upload or raw CSV text)

## Run Locally (JDK 11+)

```bash
cd java-backend
javac FaultAnalyzerServer.java
java FaultAnalyzerServer
```

Then open `http://localhost:8080` in your browser.

To forward extracted features to an external ML inference service (FastAPI, PyTorch, ONNX):

```bash
ML_SERVICE_URL=http://localhost:8000/predict java FaultAnalyzerServer
```
