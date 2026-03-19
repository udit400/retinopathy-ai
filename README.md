# Retinopathy AI — Diabetic Retinopathy Detection using CNN (PyTorch + ONNX)

![Python](https://img.shields.io/badge/Python-3.10-blue?logo=python)
![PyTorch](https://img.shields.io/badge/PyTorch-Framework-red?logo=pytorch)
![ONNX](https://img.shields.io/badge/ONNX-Model-lightblue?logo=onnx)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-green?logo=fastapi)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

A deep learning project that detects **Diabetic Retinopathy** from retinal fundus images using a **Convolutional Neural Network (CNN)**.  
The model is trained in **PyTorch**, exported to **ONNX** for lightweight inference, and served through a **FastAPI backend** with a full-featured HTML/JS frontend that supports both **Doctor** and **Patient** roles.

---

## Project Overview

Diabetic Retinopathy (DR) is one of the leading causes of blindness worldwide.  
Early detection can significantly reduce vision loss.  
This project automates the detection process by classifying retinal images into two categories:

- **DR** — Diabetic Retinopathy detected  
- **No_DR** — No Diabetic Retinopathy detected

---

## Tech Stack

- **Model:** PyTorch CNN (custom lightweight architecture, ~500K params)
- **Inference:** ONNX Runtime  
- **Backend:** FastAPI (Python 3.10)
- **Frontend:** Vanilla HTML / CSS / JavaScript (served by FastAPI, no CDN dependencies)
- **Storage:** JSON file-based user data (suitable for demo/development)
- **Deployment:** Render (backend)

---

## Features

### Authentication
- OTP-based registration for Doctors and Patients
- Role-based login with a 6-digit numeric ID + name + password
- Forgot-password flow using OTP verification

### Patient Dashboard
- View profile (ID, Name, Avatar)
- Search and select a doctor by ID / name
- Submit a retinal image and note to a doctor
- View all doctor reports (treatments, suggestions, report summary, appointment)
- Mark reports as important for quick access
- View upcoming appointments (sorted by date)
- Browse the doctor directory with fees

### Doctor Dashboard
- View profile with editable consultation fee
- Inbox of patient submissions (image + note) with patient history
- Run AI analysis on a submitted retinal image (one click)
- Fill / auto-populate report fields (treatments, suggestions, summary) from AI results
- Send a report with diagnosis back to the patient
- Auto-schedule appointments (30 normal / 5 serious slots per day, starting 3 days out)
- Doctor-to-doctor chat (WhatsApp-style messaging)
- View daily appointment list by type (normal / serious)

---

## Project Structure

```
retinopathy-ai/
│
├── app.py                      # FastAPI backend (auth, dashboards, AI inference)
├── retinopathy_model.onnx      # Exported ONNX model for inference
├── requirements.txt            # Pinned Python dependencies
├── Procfile                    # Deployment entry point (Render)
├── render.md                   # Detailed project report (CNN design, results)
├── users.json                  # Persistent user data (auto-created at startup)
├── static/
│   ├── index.html              # Single-page app (auth + patient + doctor views)
│   ├── app.js                  # Frontend logic (no external JS libraries)
│   ├── style.css               # Shared styles
│   └── images/                 # Sample retinal images (0.jpg – 4.jpg)
├── tests/
│   └── test_dashboards.py      # Unit tests for dashboard and auth flows
├── diagnosis-of-diabetic-retinopathy-by-pytorch.ipynb  # Model training notebook
└── README.md
```

---

## How It Works

1. **Registration / Login:** A user (doctor or patient) registers with their mobile number, verifies via OTP, and receives a unique 6-digit ID.
2. **Patient submits image:** The patient searches for a doctor, uploads a retinal fundus image (with an optional note), and sends it.
3. **Doctor analyses:** The doctor opens the submission, triggers AI analysis on the image (ONNX Runtime inference), and reviews the result.
4. **Doctor sends report:** The doctor fills in (or accepts the AI-pre-filled) treatments, suggestions, and summary, then sends the report back to the patient.
5. **Appointment auto-scheduled:** An appointment is automatically booked on the earliest available slot (3 days out, respecting the 30-normal / 5-serious daily cap).
6. **Patient views report:** The patient sees the full report, appointment details, and can mark it as important.

### Model Pipeline

```
Retinal Image → Resize 255×255 → Normalize (ImageNet stats) → CNN_Retino (4 conv + 2 FC) → Softmax → [DR, No_DR]
```

---

## Local Setup

```bash
# Clone the repository
git clone https://github.com/udit400/retinopathy-ai.git
cd retinopathy-ai

# Install dependencies
pip install -r requirements.txt

# Run the app
uvicorn app:app --reload
```

Then open:

```
http://127.0.0.1:8000/
```

The FastAPI backend serves the browser UI and all API endpoints from the same process.

### Run tests

```bash
python -m unittest discover -s tests -v
```

---

## API Endpoints (summary)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/send-otp` | Send OTP to a mobile number |
| `POST` | `/register` | Register doctor or patient |
| `POST` | `/login` | Login and receive a bearer token |
| `POST` | `/forgot-password` | Reset password via OTP |
| `POST` | `/logout` | Invalidate session token |
| `GET` | `/me` | Current user profile |
| `GET` | `/doctors` | List all registered doctors |
| `GET` | `/patient/dashboard` | Patient dashboard data |
| `POST` | `/patient/submissions` | Submit image + note to doctor |
| `POST` | `/patient/reports/{id}/importance` | Mark a report as important |
| `GET` | `/doctor/dashboard` | Doctor dashboard data |
| `POST` | `/doctor/profile/fees` | Update consultation fee |
| `POST` | `/doctor/messages` | Send message to another doctor |
| `POST` | `/doctor/submissions/{id}/analyze` | Run AI analysis on a submission |
| `POST` | `/doctor/reports` | Send diagnosis report to patient |
| `POST` | `/predict` | Direct image upload for AI prediction |
| `GET` | `/health` | Health / model status check |
| `GET` | `/model-info` | CNN architecture details |

---

## Results Snapshot

| Metric | Value |
|--------|-------|
| Model Type | Custom CNN (CNN_Retino) |
| Parameters | ~500,000 |
| Framework | PyTorch → ONNX |
| Classes | DR / No_DR |
| Training Accuracy | ~94% |
| Test Accuracy | ~93% |
| Inference Size | ~2 MB |
| Inference Speed | < 1 sec |

---

## License

This project is licensed under the **MIT License** — feel free to fork, modify, and use it for educational or research purposes.

---
