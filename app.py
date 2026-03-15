"""
FastAPI Backend for Diabetic Retinopathy Classification using ONNX Runtime
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import io
import os 
import time
from typing import List
import uvicorn
import onnxruntime as ort
from PIL import Image
import torchvision.transforms as transforms

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
MODEL_PATH = os.path.join(BASE_DIR, "retinopathy_model.onnx")

app = FastAPI(
    title="Diabetic Retinopathy Classification API",
    description="CNN-based retinal image analysis (DR vs No_DR) using ONNX Runtime",
    version="1.0.0"
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

# Global variables
onnx_session = None
model_loaded = False
class_names = ["DR", "No_DR"]  # 0=DR, 1=No_DR


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


@app.on_event("startup")
async def startup_event():
    print("=" * 60)
    print("Starting Diabetic Retinopathy Classification API (ONNX)")
    print("=" * 60)
    load_onnx_model()
    print("=" * 60)


@app.get("/", response_class=HTMLResponse)
async def read_root():
    try:
        with open(os.path.join(STATIC_DIR, "index.html"), "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="""
        <html>
            <head><title>Diabetic Retinopathy API</title></head>
            <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>Diabetic Retinopathy Classification API (ONNX)</h1>
                <p>Binary Classification: DR vs No_DR</p>
                <p>API is running! Visit <a href="/docs">/docs</a> for documentation.</p>
                <p><a href="/health">Check Health Status</a></p>
            </body>
        </html>
        """)


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
async def predict_retinopathy(file: UploadFile = File(...)):
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
            "Diabetic retinopathy detected — please seek medical attention soon",
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
