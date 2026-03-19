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
from typing import List, Optional, Dict
import uvicorn
import onnxruntime as ort
from PIL import Image
import torchvision.transforms as transforms
from pydantic import BaseModel

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
            import json
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
                users[key] = u
        except Exception:
            users = {}
    else:
        users = {}


def _save_users() -> None:
    try:
        import json
        os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)
    except Exception:
        pass


def _create_default_user() -> None:
    # Check if demo user already exists (keyed by user_id or username "demo")
    if any(u.get("username") == "demo" or u.get("name") == "Demo Doctor" for u in users.values()):
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
            "password": _hash_password("demo123"),
            "created_at": time.time(),
        }
        _save_users()


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
        
        # Use the same transforms as in the training (without augmentation)
        transform = transforms.Compose([
            transforms.Resize((255, 255)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406],
                               std=[0.229, 0.224, 0.225])
        ])
        
        # Apply transformations
        image_tensor = transform(image).unsqueeze(0)
        
        # Convert to numpy and ensure float32 type for ONNX
        return image_tensor.numpy().astype(np.float32)
        
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
    }


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
        image_array = preprocess_image(image_bytes)
        
        # Run inference with ONNX Runtime
        input_name = onnx_session.get_inputs()[0].name
        output_name = onnx_session.get_outputs()[0].name
        
        outputs = onnx_session.run([output_name], {input_name: image_array})[0]
        
        # Convert logits to probabilities using softmax (more stable than exp alone)
        exp_outputs = np.exp(outputs - np.max(outputs, axis=1, keepdims=True))
        probabilities = exp_outputs / np.sum(exp_outputs, axis=1, keepdims=True)
        
        predicted_class = int(np.argmax(probabilities, axis=1)[0])
        confidence = float(probabilities[0][predicted_class])
        
        severity_text = get_severity_text(predicted_class, confidence)
        
        results = {
            "predicted_class": predicted_class,
            "predicted_class_name": class_names[predicted_class],
            "confidence": round(confidence * 100, 2),
            "all_probabilities": {
                class_names[i]: round(float(probabilities[0][i]) * 100, 2)
                for i in range(len(class_names))
            },
            "diagnosis": get_diagnosis(predicted_class, confidence),
            "recommendations": get_recommendations(predicted_class, confidence),
            "severity_level": severity_text
        }
        
        return results
        
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
