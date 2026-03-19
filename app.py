"""
FastAPI Backend for Diabetic Retinopathy Classification using ONNX Runtime
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import numpy as np
import io
import os
import time
import hashlib
import secrets
import random
import json
import base64
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict
import uvicorn
import onnxruntime as ort
from PIL import Image
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
MODEL_PATH = os.path.join(BASE_DIR, "retinopathy_model.onnx")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 60)
    print("Starting MediSight Health (Retinal Diagnostic Suite)")
    print("=" * 60)
    _load_users()
    _create_default_user()
    load_onnx_model()
    print("=" * 60)
    yield
    print("Shutting down MediSight Health")


app = FastAPI(
    title="MediSight Health - Retinal Diagnostic API",
    description="AI-powered retinal image analysis for diabetic retinopathy screening (ONNX Runtime)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
except Exception:
    print("Warning: Static directory not found")

# User ID / OTP generation constants
USER_ID_MIN = 100000
USER_ID_MAX = 999999
OTP_MIN = 100000
OTP_MAX = 999999
MAX_ID_GENERATION_ATTEMPTS = 1000
OTP_EXPIRY_SECONDS = 300  # 5 minutes
onnx_session = None
model_loaded = False
class_names = ["DR", "No_DR"]  # 0=DR, 1=No_DR

# Simple user/auth and payment simulation (demo purposes only)
USERS_FILE = os.path.join(BASE_DIR, "users.json")
users: Dict[str, dict] = {}
sessions: Dict[str, str] = {}  # token -> user_key
otps: Dict[str, dict] = {}     # mobile -> {otp, expires_at}
security = HTTPBearer()
DEFAULT_DOCTOR_FEE = 1.0
NORMAL_APPOINTMENTS_PER_DAY = 30
SERIOUS_APPOINTMENTS_PER_DAY = 5

class UserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class PaymentRequest(BaseModel):
    amount: float
    currency: str = "USD"
    plan: Optional[str] = None

class SendOtpRequest(BaseModel):
    mobile: str

class RegisterRequest(BaseModel):
    role: str           # "doctor" or "patient"
    name: str
    mobile: str
    otp: str
    password: str
    department: Optional[str] = None  # required for doctors

class LoginRequest(BaseModel):
    user_id: str        # 6-digit numeric ID
    name: str
    password: str

class ForgotPasswordRequest(BaseModel):
    mobile: str
    otp: str
    new_password: str


class PatientSubmissionRequest(BaseModel):
    doctor_id: str
    note: str = ""
    image_name: Optional[str] = None
    image_data_url: Optional[str] = None


class DoctorReportRequest(BaseModel):
    submission_id: str
    treatments: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    report_summary: str = ""
    note: str = ""
    severity: Optional[str] = None
    appointment_date: Optional[str] = None
    appointment_type: Optional[str] = None


class DoctorFeeRequest(BaseModel):
    fee: float


class DoctorMessageRequest(BaseModel):
    doctor_id: str
    message: str


class ImportanceRequest(BaseModel):
    report_id: str
    important: bool


def load_onnx_model():
    """Load the ONNX model"""
    global onnx_session, model_loaded
    
    try:
        if not os.path.exists(MODEL_PATH):
            print(f"ERROR: No ONNX model file found at: {MODEL_PATH}")
            print(f"Current directory: {os.getcwd()}")
            print(f"Files in directory: {os.listdir('.')}" )
            return
        
        print(f"Loading ONNX model from: {MODEL_PATH}")
        
        # Create inference session with ONNX runtime
        onnx_session = ort.InferenceSession(MODEL_PATH)
        
        model_loaded = True
        print("ONNX model loaded and ready!")
        
    except Exception as e:
        print(f"Model loading failed: {str(e)}")
        import traceback
        print(traceback.format_exc())
        model_loaded = False


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${digest}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest = stored_hash.split("$", 1)
    except ValueError:
        return False
    return _hash_password(password, salt) == stored_hash


def _load_users() -> None:
    global users
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f) or {}
            users = {}
            for key, u in loaded.items():
                # Migrate legacy users to new schema
                if "user_id" not in u:
                    u["user_id"] = key
                    u["name"] = u.get("full_name") or u.get("username") or key
                    u["role"] = u.get("role", "doctor")
                    u.setdefault("mobile", "")
                _ensure_user_defaults(u)
                users[key] = u
        except Exception:
            users = {}
    else:
        users = {}


def _save_users() -> None:
    try:
        os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)
    except Exception:
        pass


def _create_default_user() -> None:
    # Check if demo user already exists (keyed by user_id or username "demo")
    if any(u.get("username") == "demo" or u.get("name") == "Demo Doctor" for u in users.values()):
        for user in users.values():
            _ensure_user_defaults(user)
        _save_users()
        return
    if "demo" not in users:
        demo_id = _generate_numeric_id()
        users[demo_id] = {
            "user_id": demo_id,
            "username": "demo",
            "name": "Demo Doctor",
            "full_name": "Demo Doctor",
            "role": "doctor",
            "mobile": "",
            "department": "General",
            "fees": DEFAULT_DOCTOR_FEE,
            "password": _hash_password("demo123"),
            "created_at": time.time(),
        }
        _ensure_user_defaults(users[demo_id])
        _save_users()


def _ensure_user_defaults(user: dict) -> dict:
    user.setdefault("profile_image", "")
    if user.get("role") == "doctor":
        user.setdefault("fees", DEFAULT_DOCTOR_FEE)
        user.setdefault("department", user.get("department") or "General")
        user.setdefault("patient_submissions", [])
        user.setdefault("doctor_messages", [])
        user.setdefault("appointments", [])
    else:
        user.setdefault("doctor_reports", [])
        user.setdefault("appointments", [])
        user.setdefault("important_reports", [])
    return user


def _serialize_user(user: dict) -> dict:
    safe_user = dict(user)
    safe_user.pop("password", None)
    return safe_user


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _avatar_text(user: dict) -> str:
    name = (user.get("name") or user.get("full_name") or user.get("username") or "?").strip()
    letters = [part[:1].upper() for part in name.split()[:2] if part]
    return "".join(letters) or name[:2].upper() or "?"


def _doctor_public_profile(user: dict) -> dict:
    return {
        "user_id": user.get("user_id"),
        "name": user.get("name") or user.get("full_name"),
        "department": user.get("department") or "General",
        "fees": float(user.get("fees") or DEFAULT_DOCTOR_FEE),
        "avatar_text": _avatar_text(user),
        "image_url": user.get("profile_image") or "",
    }


def _patient_public_profile(user: dict) -> dict:
    return {
        "user_id": user.get("user_id"),
        "name": user.get("name") or user.get("full_name"),
        "mobile": user.get("mobile", ""),
        "avatar_text": _avatar_text(user),
        "image_url": user.get("profile_image") or "",
    }


def _normalize_text_list(values: List[str]) -> List[str]:
    return [value.strip() for value in values if isinstance(value, str) and value.strip()]


def _decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise HTTPException(status_code=400, detail="Data URL does not contain the expected separator")
    try:
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid data URL format") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Failed to decode base64 image data") from exc


def _analyze_image_bytes(image_bytes: bytes) -> dict:
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    image_array = preprocess_image(image_bytes)
    input_name = onnx_session.get_inputs()[0].name
    output_name = onnx_session.get_outputs()[0].name
    outputs = onnx_session.run([output_name], {input_name: image_array})[0]
    exp_outputs = np.exp(outputs - np.max(outputs, axis=1, keepdims=True))
    probabilities = exp_outputs / np.sum(exp_outputs, axis=1, keepdims=True)

    predicted_class = int(np.argmax(probabilities, axis=1)[0])
    confidence = float(probabilities[0][predicted_class])
    return {
        "predicted_class": predicted_class,
        "predicted_class_name": class_names[predicted_class],
        "confidence": round(confidence * 100, 2),
        "all_probabilities": {
            class_names[i]: round(float(probabilities[0][i]) * 100, 2)
            for i in range(len(class_names))
        },
        "diagnosis": get_diagnosis(predicted_class, confidence),
        "recommendations": get_recommendations(predicted_class, confidence),
        "severity_level": get_severity_text(predicted_class, confidence),
    }


def _find_submission_for_doctor(doctor: dict, submission_id: str) -> Optional[dict]:
    for submission in doctor.get("patient_submissions", []):
        if submission.get("submission_id") == submission_id:
            return submission
    return None


def _find_report_for_patient(patient: dict, report_id: str) -> Optional[dict]:
    for report in patient.get("doctor_reports", []):
        if report.get("report_id") == report_id:
            return report
    return None


def _schedule_appointment(doctor: dict, patient: dict, severity: str, report_summary: str) -> dict:
    severity_key = "serious" if severity == "serious" else "normal"
    slot_limit = SERIOUS_APPOINTMENTS_PER_DAY if severity_key == "serious" else NORMAL_APPOINTMENTS_PER_DAY
    start_date = datetime.now(timezone.utc).date() + timedelta(days=3)

    while True:
        candidate = start_date.isoformat()
        existing = [
            appointment for appointment in doctor.get("appointments", [])
            if appointment.get("appointment_date") == candidate and appointment.get("appointment_type") == severity_key
        ]
        if len(existing) < slot_limit:
            appointment_number = len(existing) + 1
            appointment = {
                "appointment_id": secrets.token_hex(6),
                "appointment_date": candidate,
                "appointment_type": severity_key,
                "slot_number": appointment_number,
                "doctor_id": doctor.get("user_id"),
                "doctor_name": doctor.get("name") or doctor.get("full_name"),
                "patient_id": patient.get("user_id"),
                "patient_name": patient.get("name") or patient.get("full_name"),
                "patient_mobile": patient.get("mobile", ""),
                "summary": report_summary.strip() or "Retinopathy follow-up review",
                "created_at": _now_iso(),
            }
            doctor.setdefault("appointments", []).append(appointment)
            patient.setdefault("appointments", []).append(appointment.copy())
            return appointment
        start_date += timedelta(days=1)


def _generate_numeric_id() -> str:
    """Generate a unique 6-digit numeric ID."""
    for _ in range(MAX_ID_GENERATION_ATTEMPTS):
        id_str = str(random.randint(USER_ID_MIN, USER_ID_MAX))
        if id_str not in users:
            return id_str
    raise RuntimeError("Could not generate a unique numeric ID")


def _generate_otp() -> str:
    """Generate a 6-digit OTP."""
    return str(random.randint(OTP_MIN, OTP_MAX))


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    key = sessions.get(token)
    if not key or key not in users:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return users[key]


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Preprocess image to match the input expected by the model"""
    try:
        image = Image.open(io.BytesIO(image_bytes))

        if image.mode != 'RGB':
            image = image.convert('RGB')

        image = image.resize((255, 255))
        image_array = np.asarray(image, dtype=np.float32) / 255.0
        image_array = np.transpose(image_array, (2, 0, 1))
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
        image_array = (image_array - mean) / std
        return np.expand_dims(image_array, axis=0).astype(np.float32)

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image preprocessing failed: {str(e)}")




@app.get("/", response_class=HTMLResponse)
async def read_root():
    try:
        with open(os.path.join(STATIC_DIR, "index.html"), "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="""
        <html>
            <head><title>MediSight Health API</title></head>
            <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>MediSight Health - Retinal Diagnostic API</h1>
                <p>AI-powered retinal image analysis (Diabetic Retinopathy Screening)</p>
                <p>API is running! Visit <a href="/docs">/docs</a> for documentation.</p>
                <p><a href="/health">Check Health Status</a></p>
            </body>
        </html>
        """)


@app.post("/send-otp")
async def send_otp(request: SendOtpRequest):
    """Generate and store a 6-digit OTP for the given mobile number.
    In production this would be delivered via SMS; for this demo the OTP
    is returned in the response body so it can be displayed on screen."""
    if not request.mobile or len(request.mobile) < 7:
        raise HTTPException(status_code=400, detail="Invalid mobile number")
    otp = _generate_otp()
    otps[request.mobile] = {
        "otp": otp,
        "expires_at": time.time() + OTP_EXPIRY_SECONDS,
    }
    return {
        "message": f"OTP sent to {request.mobile}",
        "otp_demo": otp,   # shown on-screen for demo; remove in production
        "expires_in": OTP_EXPIRY_SECONDS,
    }


@app.post("/register")
async def register_user(request: RegisterRequest):
    """Register a new doctor or patient."""
    if request.role not in ("doctor", "patient"):
        raise HTTPException(status_code=400, detail="Role must be 'doctor' or 'patient'")
    if request.role == "doctor" and not request.department:
        raise HTTPException(status_code=400, detail="Department is required for doctor registration")

    # Verify OTP
    stored_otp = otps.get(request.mobile)
    if not stored_otp:
        raise HTTPException(status_code=400, detail="OTP not found. Please request a new OTP.")
    if stored_otp["otp"] != request.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    if time.time() > stored_otp["expires_at"]:
        raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")

    # Check for duplicate mobile
    for u in users.values():
        if u.get("mobile") == request.mobile:
            raise HTTPException(status_code=400, detail="Mobile number is already registered")

    # Generate unique 6-digit ID
    user_id = _generate_numeric_id()

    user_data: dict = {
        "user_id": user_id,
        "role": request.role,
        "name": request.name,
        "full_name": request.name,
        "mobile": request.mobile,
        "password": _hash_password(request.password),
        "created_at": time.time(),
    }
    if request.role == "doctor":
        user_data["department"] = request.department
        user_data["fees"] = DEFAULT_DOCTOR_FEE

    _ensure_user_defaults(user_data)
    users[user_id] = user_data
    otps.pop(request.mobile, None)  # consume OTP
    _save_users()

    token = secrets.token_urlsafe(32)
    sessions[token] = user_id
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user_id,
        "role": request.role,
        "message": (
            f"Registration successful! Your {request.role.capitalize()} ID is {user_id}. "
            f"It has been sent to {request.mobile}."
        ),
    }


@app.post("/login")
async def login_user(credentials: LoginRequest):
    """Login with user_id, name, and password."""
    user = users.get(credentials.user_id)
    # Fallback: legacy username key
    if not user:
        for u in users.values():
            if u.get("username") == credentials.user_id:
                user = u
                break
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid ID, name, or password")

    # Verify name (case-insensitive)
    stored_name = (user.get("name") or user.get("full_name") or user.get("username") or "").strip().lower()
    if stored_name != credentials.name.strip().lower():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid ID, name, or password")

    if not _verify_password(credentials.password, user.get("password", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid ID, name, or password")

    key = user.get("user_id") or user.get("username")
    token = secrets.token_urlsafe(32)
    sessions[token] = key
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.get("role", "patient"),
        "user_id": user.get("user_id", key),
    }


@app.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """Reset password using mobile OTP verification."""
    stored_otp = otps.get(request.mobile)
    if not stored_otp:
        raise HTTPException(status_code=400, detail="OTP not found. Please request a new OTP.")
    if stored_otp["otp"] != request.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    if time.time() > stored_otp["expires_at"]:
        raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")

    # Find user by mobile
    target_user = None
    for u in users.values():
        if u.get("mobile") == request.mobile:
            target_user = u
            break
    if not target_user:
        raise HTTPException(status_code=404, detail="No account found with this mobile number")

    target_user["password"] = _hash_password(request.new_password)
    otps.pop(request.mobile, None)
    _save_users()

    return {
        "message": (
            f"Password reset successful. Your ID ({target_user['user_id']}) and new password "
            f"have been sent to {request.mobile}."
        ),
        "user_id": target_user["user_id"],
        "role": target_user.get("role", "patient"),
    }


@app.post("/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    sessions.pop(token, None)
    return JSONResponse({"detail": "Logged out"})


@app.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {
        "user_id": current_user.get("user_id"),
        "username": current_user.get("username", current_user.get("user_id")),
        "name": current_user.get("name") or current_user.get("full_name"),
        "full_name": current_user.get("full_name") or current_user.get("name"),
        "role": current_user.get("role", "patient"),
        "department": current_user.get("department"),
        "mobile": current_user.get("mobile", ""),
        "fees": float(current_user.get("fees") or DEFAULT_DOCTOR_FEE),
        "avatar_text": _avatar_text(current_user),
        "image_url": current_user.get("profile_image") or "",
    }


@app.get("/doctors")
async def list_doctors(current_user: dict = Depends(get_current_user)):
    doctors = [
        _doctor_public_profile(user)
        for user in users.values()
        if user.get("role") == "doctor"
    ]
    doctors.sort(key=lambda item: (item["name"] or "").lower())
    return {"doctors": doctors}


@app.get("/patient/dashboard")
async def patient_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients can access this dashboard")

    reports = sorted(
        current_user.get("doctor_reports", []),
        key=lambda report: report.get("sent_at", ""),
        reverse=True,
    )
    return {
        "patient": _patient_public_profile(current_user),
        "reports": reports,
        "appointments": sorted(
            current_user.get("appointments", []),
            key=lambda appointment: (appointment.get("appointment_date", ""), appointment.get("slot_number", 0)),
        ),
        "important_reports": [
            report for report in reports
            if report.get("important") or report.get("report_id") in current_user.get("important_reports", [])
        ],
    }


@app.post("/patient/submissions")
async def create_patient_submission(
    request: PatientSubmissionRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients can send submissions")

    doctor = users.get(request.doctor_id)
    if not doctor or doctor.get("role") != "doctor":
        raise HTTPException(status_code=404, detail="Doctor not found")

    if not request.note.strip() and not request.image_data_url:
        raise HTTPException(status_code=400, detail="Please provide a note or retinal image")

    submission = {
        "submission_id": secrets.token_hex(6),
        "patient_id": current_user.get("user_id"),
        "patient_name": current_user.get("name") or current_user.get("full_name"),
        "patient_mobile": current_user.get("mobile", ""),
        "doctor_id": doctor.get("user_id"),
        "doctor_name": doctor.get("name") or doctor.get("full_name"),
        "note": request.note.strip(),
        "image_name": (request.image_name or "").strip(),
        "image_data_url": request.image_data_url or "",
        "created_at": _now_iso(),
        "status": "new",
        "ai_result": None,
    }
    doctor.setdefault("patient_submissions", []).append(submission)
    _save_users()
    return {"message": "Retinopathy image and note sent to doctor", "submission": submission}


@app.post("/patient/reports/{report_id}/importance")
async def mark_report_importance(
    report_id: str,
    request: ImportanceRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients can update importance")
    if request.report_id != report_id:
        raise HTTPException(status_code=400, detail="Report mismatch")

    report = _find_report_for_patient(current_user, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    report["important"] = bool(request.important)
    important_ids = set(current_user.get("important_reports", []))
    if request.important:
        important_ids.add(report_id)
    else:
        important_ids.discard(report_id)
    current_user["important_reports"] = sorted(important_ids)
    _save_users()
    return {"message": "Importance updated", "report": report}


@app.get("/doctor/dashboard")
async def doctor_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can access this dashboard")

    submissions = []
    for item in current_user.get("patient_submissions", []):
        patient = users.get(item.get("patient_id"), {})
        submissions.append({
            **item,
            "patient_profile": _patient_public_profile(patient) if patient else {},
            "patient_history": sorted(
                patient.get("doctor_reports", []),
                key=lambda report: report.get("sent_at", ""),
                reverse=True,
            )[:5] if patient else [],
        })
    submissions.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    conversations = {}
    for message in current_user.get("doctor_messages", []):
        other_id = message.get("from_doctor_id")
        if other_id == current_user.get("user_id"):
            other_id = message.get("to_doctor_id")
        conversations.setdefault(other_id, []).append(message)

    return {
        "doctor": _doctor_public_profile(current_user),
        "patient_messages": submissions,
        "doctor_chats": [
            {
                "doctor": _doctor_public_profile(users[doctor_id]),
                "messages": sorted(messages, key=lambda message: message.get("created_at", "")),
            }
            for doctor_id, messages in conversations.items()
            if doctor_id in users and users[doctor_id].get("role") == "doctor"
        ],
        "appointments": sorted(
            current_user.get("appointments", []),
            key=lambda appointment: (appointment.get("appointment_date", ""), appointment.get("slot_number", 0)),
        ),
    }


@app.post("/doctor/profile/fees")
async def update_doctor_fee(
    request: DoctorFeeRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can update fees")
    if request.fee <= 0:
        raise HTTPException(status_code=400, detail="Fees must be greater than zero")

    current_user["fees"] = round(float(request.fee), 2)
    _save_users()
    return {"message": "Fees updated", "doctor": _doctor_public_profile(current_user)}


@app.post("/doctor/messages")
async def send_doctor_message(
    request: DoctorMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can send doctor chat messages")
    target = users.get(request.doctor_id)
    if not target or target.get("role") != "doctor":
        raise HTTPException(status_code=404, detail="Doctor not found")
    message_text = request.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    message = {
        "message_id": secrets.token_hex(6),
        "from_doctor_id": current_user.get("user_id"),
        "from_doctor_name": current_user.get("name") or current_user.get("full_name"),
        "to_doctor_id": target.get("user_id"),
        "to_doctor_name": target.get("name") or target.get("full_name"),
        "message": message_text,
        "created_at": _now_iso(),
    }
    current_user.setdefault("doctor_messages", []).append(message)
    target.setdefault("doctor_messages", []).append(message.copy())
    _save_users()
    return {"message": "Doctor message sent", "chat_message": message}


@app.post("/doctor/submissions/{submission_id}/analyze")
async def analyze_submission(
    submission_id: str,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can analyze submissions")

    submission = _find_submission_for_doctor(current_user, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not submission.get("image_data_url"):
        raise HTTPException(status_code=400, detail="Submission does not include an image")

    if not submission.get("ai_result"):
        submission["ai_result"] = _analyze_image_bytes(_decode_data_url(submission["image_data_url"]))
        submission["status"] = "analyzed"
        _save_users()
    return {"submission": submission}


@app.post("/doctor/reports")
async def send_doctor_report(
    request: DoctorReportRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can send reports")

    submission = _find_submission_for_doctor(current_user, request.submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    patient = users.get(submission.get("patient_id"))
    if not patient or patient.get("role") != "patient":
        raise HTTPException(status_code=404, detail="Patient not found")

    ai_result = submission.get("ai_result")
    severity = (request.severity or "").strip().lower()
    if severity not in {"normal", "serious"}:
        if ai_result and ai_result.get("predicted_class_name") == "DR":
            severity = "serious"
        else:
            severity = "normal"

    treatments = _normalize_text_list(request.treatments) or [
        "Blood sugar optimisation plan",
        "Retinal specialist review",
    ]
    suggestions = _normalize_text_list(request.suggestions) or (
        ai_result.get("recommendations", []) if ai_result else ["Continue regular retinal follow-up"]
    )
    report_summary = request.report_summary.strip() or (
        ai_result.get("diagnosis") if ai_result else "Doctor reviewed the retinal submission."
    )
    note = request.note.strip() or submission.get("note", "")

    appointment = None
    if request.appointment_date:
        appointment_type = (request.appointment_type or severity).strip().lower() or severity
        same_day = [
            item for item in current_user.get("appointments", [])
            if item.get("appointment_date") == request.appointment_date and item.get("appointment_type") == appointment_type
        ]
        appointment = {
            "appointment_id": secrets.token_hex(6),
            "appointment_date": request.appointment_date,
            "appointment_type": appointment_type,
            "slot_number": len(same_day) + 1,
            "doctor_id": current_user.get("user_id"),
            "doctor_name": current_user.get("name") or current_user.get("full_name"),
            "patient_id": patient.get("user_id"),
            "patient_name": patient.get("name") or patient.get("full_name"),
            "patient_mobile": patient.get("mobile", ""),
            "summary": report_summary,
            "created_at": _now_iso(),
        }
        current_user.setdefault("appointments", []).append(appointment)
        patient.setdefault("appointments", []).append(appointment.copy())
    else:
        appointment = _schedule_appointment(current_user, patient, severity, report_summary)

    report = {
        "report_id": secrets.token_hex(6),
        "submission_id": submission.get("submission_id"),
        "doctor_id": current_user.get("user_id"),
        "doctor_name": current_user.get("name") or current_user.get("full_name"),
        "doctor_fee": float(current_user.get("fees") or DEFAULT_DOCTOR_FEE),
        "patient_id": patient.get("user_id"),
        "patient_name": patient.get("name") or patient.get("full_name"),
        "sent_at": _now_iso(),
        "severity": severity,
        "treatments": treatments,
        "suggestions": suggestions,
        "report_summary": report_summary,
        "note": note,
        "appointment": appointment,
        "ai_result": ai_result,
        "important": False,
    }

    patient.setdefault("doctor_reports", []).append(report)
    submission["status"] = "replied"
    submission["report_id"] = report["report_id"]
    submission["report_summary"] = report_summary
    _save_users()
    return {"message": "Doctor report sent to patient", "report": report}


@app.post("/payment")
async def create_payment(request: PaymentRequest, current_user: dict = Depends(get_current_user)):
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    transaction_id = secrets.token_hex(12)
    return {
        "status": "success",
        "transaction_id": transaction_id,
        "amount": request.amount,
        "currency": request.currency,
        "plan": request.plan or "standard",
        "message": f"Payment processed successfully for {current_user.get('full_name')}.",
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy" if model_loaded else "degraded",
        "model_loaded": model_loaded,
        "backend": "ONNX Runtime",
        "model_architecture": "CNN_Retino (4 Conv + 2 FC)",
        "num_classes": 2,
        "classes": class_names,
        "timestamp": time.time()
    }


@app.post("/predict")
async def predict_retinopathy(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        image_bytes = await file.read()
        return _analyze_image_bytes(image_bytes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


def get_diagnosis(class_idx: int, confidence: float) -> str:
    if class_idx == 0:
        if confidence >= 0.85:
            return "Diabetic Retinopathy Detected (high confidence)"
        elif confidence >= 0.65:
            return "Diabetic Retinopathy Detected (moderate confidence)"
        else:
            return "Possible Diabetic Retinopathy (low confidence)"

    if class_idx == 1:
        if confidence >= 0.85:
            return "No Diabetic Retinopathy Detected (high confidence)"
        elif confidence >= 0.65:
            return "No Diabetic Retinopathy Detected (moderate confidence)"
        else:
            return "Negative result but low confidence"

    return "Unknown"


def get_recommendations(class_idx: int, confidence: float) -> List[str]:
    if class_idx == 0:
        recs = [
            "Diabetic retinopathy detected - please seek medical attention soon",
            "Schedule an appointment with an ophthalmologist within the next 1-2 weeks",
            "Control blood sugar (HbA1c) through diet and medication",
            "Monitor blood pressure and lipid levels closely",
            "Keep a log of vision changes and share with your doctor"
        ]
        if confidence < 0.70:
            recs.insert(1, "Consider repeating the scan or getting a second opinion for confirmation")
        if confidence >= 0.90:
            recs.append("Discuss treatment options such as laser therapy or anti-VEGF injections with your specialist")
        return recs

    if class_idx == 1:
        recs = [
            "No signs of diabetic retinopathy detected",
            "Continue regular eye exams as recommended by your doctor",
            "Maintain stable blood sugar control (HbA1c targets) and healthy lifestyle",
            "Stay consistent with medication and follow up screenings",
            "Report any sudden vision changes to your healthcare provider immediately"
        ]
        if confidence < 0.70:
            recs.insert(1, "While the result is reassuring, consider repeating the scan in 3-6 months")
        return recs

    return ["Consult with your healthcare provider for personalized advice"]


def get_severity_text(class_idx: int, confidence: float) -> str:
    if class_idx == 0:
        if confidence >= 0.90:
            return "High probability of diabetic retinopathy - prompt medical evaluation recommended."
        if confidence >= 0.70:
            return "Moderate probability of diabetic retinopathy - follow up with a specialist."
        return "Low probability but still recommend follow-up and re-check in a short interval."

    if class_idx == 1:
        if confidence >= 0.90:
            return "Low probability of diabetic retinopathy - continue regular monitoring."
        if confidence >= 0.70:
            return "Moderate confidence in a negative result; repeat screening as recommended."
        return "Result has low confidence; consider a follow-up exam."

    return "Assessment not available."

@app.get("/model-info")
async def get_model_info():
    if not model_loaded:
        return {"error": "Model not loaded"}
    
    return {
        "model_loaded": model_loaded,
        "backend": "ONNX Runtime",
        "class_names": class_names,
        "model_architecture": "CNN_Retino",
        "layers": {
            "conv_layers": 4,
            "fc_layers": 2,
            "filters": [8, 16, 32, 64],
            "fc_neurons": [100, 2]
        },
        "input_size": "255x255",
        "num_classes": 2,
        "training_accuracy": "94%",
        "test_accuracy": "93%"
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
