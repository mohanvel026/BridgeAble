// client/src/pages/Onboarding.jsx
// Blink calibration wizard for paralyzed/ALS users
// Uses MediaPipe FaceMesh to measure personal EAR thresholds

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import toast from 'react-hot-toast';

const STEPS = [
  { id: 1, title: 'Blink normally 5 times', subtitle: 'Sets your baseline blink threshold', target: 5 },
  { id: 2, title: 'Do one long blink', subtitle: 'Hold for 1 second — this is a Morse dash', target: 1 },
  { id: 3, title: 'Practice: spell "HI"', subtitle: '···· ··  — short=dot, long=dash', target: 0 },
];

// EAR = Eye Aspect Ratio = sum of vertical distances / (2 * horizontal distance)
function computeEAR(landmarks, eyeIndices) {
  const pts = eyeIndices.map(i => landmarks[i]);
  const A = dist(pts[1], pts[5]);
  const B = dist(pts[2], pts[4]);
  const C = dist(pts[0], pts[3]);
  return (A + B) / (2.0 * C);
}
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// FaceMesh landmark indices for left eye
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);

  const [step, setStep] = useState(1);
  const [blinkCount, setBlinkCount] = useState(0);
  const [earValues, setEarValues] = useState([]);
  const [dashMs, setDashMs] = useState(null);
  const [blinkStart, setBlinkStart] = useState(null);
  const [isEyeClosed, setIsEyeClosed] = useState(false);
  const [morseBuffer, setMorseBuffer] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [saving, setSaving] = useState(false);

  const earThresholdRef = useRef(0.25);
  const blinkCountRef = useRef(0);
  const earValuesRef = useRef([]);
  const stepRef = useRef(1);
  const isEyeClosedRef = useRef(false);
  const blinkStartRef = useRef(null);
  const dashMsRef = useRef(400);

  // Sync refs with state
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { blinkCountRef.current = blinkCount; }, [blinkCount]);
  useEffect(() => { earValuesRef.current = earValues; }, [earValues]);
  useEffect(() => { isEyeClosedRef.current = isEyeClosed; }, [isEyeClosed]);

  // Load FaceMesh
  useEffect(() => {
    loadFaceMesh();
    return () => { cameraRef.current?.stop(); };
  }, []);

  const loadFaceMesh = async () => {
    try {
      const faceMeshModule = await import('@mediapipe/face_mesh');
      const FaceMesh = faceMeshModule.FaceMesh || faceMeshModule.default?.FaceMesh || window.FaceMesh;
      
      const cameraModule = await import('@mediapipe/camera_utils');
      const Camera = cameraModule.Camera || cameraModule.default?.Camera || window.Camera;

      const faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults(onResults);
      faceMeshRef.current = faceMesh;

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current && faceMeshRef.current) {
            await faceMeshRef.current.send({ image: videoRef.current });
          }
        },
        width: 640, height: 480,
      });
      
      const timeoutId = setTimeout(() => {
        if (!cameraReady) {
          setCameraError('Camera took too long to start. Please check permissions.');
        }
      }, 10000);

      await camera.start();
      clearTimeout(timeoutId);
      
      cameraRef.current = camera;
      setCameraReady(true);
    } catch (err) {
      console.error("FaceMesh init error:", err);
      setCameraError(err.message || 'Failed to access camera.');
    }
  };

  const onResults = useCallback((results) => {
    if (!results.multiFaceLandmarks?.length) return;
    const landmarks = results.multiFaceLandmarks[0];

    const leftEAR = computeEAR(landmarks, LEFT_EYE);
    const rightEAR = computeEAR(landmarks, RIGHT_EYE);
    const ear = (leftEAR + rightEAR) / 2;

    const threshold = earThresholdRef.current;
    const eyeClosed = ear < threshold;
    const wasOpen = !isEyeClosedRef.current;

    if (stepRef.current === 1 && !eyeClosed) {
      // Collecting baseline EAR values when eye is open
      earValuesRef.current = [...earValuesRef.current.slice(-30), ear];
      setEarValues(v => [...v.slice(-30), ear]);
    }

    if (eyeClosed && wasOpen) {
      // Eye just closed
      setIsEyeClosed(true);
      isEyeClosedRef.current = true;
      blinkStartRef.current = Date.now();
      setBlinkStart(Date.now());
    } else if (!eyeClosed && !wasOpen) {
      // Eye just opened
      setIsEyeClosed(false);
      isEyeClosedRef.current = false;
      const duration = Date.now() - (blinkStartRef.current || Date.now());
      blinkStartRef.current = null;

      // Step-specific logic
      if (stepRef.current === 1) {
        const newCount = blinkCountRef.current + 1;
        setBlinkCount(newCount);
        blinkCountRef.current = newCount;

        if (newCount >= 5) {
          const avgEAR = earValuesRef.current.reduce((a, b) => a + b, 0) / Math.max(1, earValuesRef.current.length);
          earThresholdRef.current = avgEAR * 0.8;
          setTimeout(() => {
            toast.success('Baseline captured!');
            setStep(2);
          }, 500);
        }
      } else if (stepRef.current === 2) {
        dashMsRef.current = duration;
        setDashMs(duration);
        setTimeout(() => {
          toast.success(`Dash threshold: ${duration}ms`);
          setStep(3);
        }, 500);
      } else if (stepRef.current === 3) {
        // Practice morse
        const type = duration >= dashMsRef.current ? '· ' : '·'; // Just visual feedback, using middle dot for dot and space for dash
        // Wait, Morse dash is usually a hyphen. Let's use standard dot/dash.
        const symbol = duration >= dashMsRef.current ? '-' : '·';
        setMorseBuffer(prev => prev + symbol);
      }
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/auth/blink-calibration', {
        earThreshold: earThresholdRef.current,
        dashMs: dashMsRef.current || 400,
      });
      updateUser({ blinkProfile: { earThreshold: earThresholdRef.current, dashMs: dashMsRef.current || 400, calibrated: true } });
      toast.success('Calibration saved! You are all set.');
      navigate('/dashboard');
    } catch {
      toast.error('Failed to save calibration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-mesh-dark flex items-center justify-center p-4">
      <div className="w-full max-w-2xl animate-scale-in">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-violet/10 border border-accent-violet/20 mb-4">
            <span className="w-2 h-2 rounded-full bg-accent-violet animate-blink-dot" />
            <span className="text-xs text-accent-violet font-medium">Blink Calibration</span>
          </div>
          <h1 className="font-display text-3xl font-semibold mb-2">Setting up your blink profile</h1>
          <p className="text-text-secondary text-sm max-w-md mx-auto">
            We measure your personal eye patterns so BridgeAble understands your unique blinks.
            This takes about 60 seconds.
          </p>
        </div>

        {/* Step progress */}
        <div className="flex justify-center gap-6 mb-6">
          {STEPS.map(s => (
            <div key={s.id} className={`flex items-center gap-2 transition-all ${step >= s.id ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
                               ${step > s.id ? 'bg-accent-teal text-dark-950' :
                  step === s.id ? 'bg-accent-violet text-white' : 'bg-dark-800 text-text-muted'}`}>
                {step > s.id ? '✓' : s.id}
              </div>
              <span className={`text-xs ${step === s.id ? 'text-accent-violet' : 'text-text-muted'}`}>
                Step {s.id}
              </span>
            </div>
          ))}
        </div>

        <div className="card p-6">
          {/* Camera view */}
          <div className="relative rounded-xl overflow-hidden mb-6 bg-dark-900" style={{ aspectRatio: '4/3' }}>
            <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900">
                <div className="w-8 h-8 border-2 border-accent-violet/30 border-t-accent-violet rounded-full animate-spin mb-3" />
                <p className="text-text-secondary text-sm">Loading FaceMesh...</p>
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900 p-6 text-center">
                <div className="w-12 h-12 bg-accent-rose/20 rounded-full flex items-center justify-center text-accent-rose text-2xl mb-3">⚠️</div>
                <p className="text-text-primary font-medium mb-1">Camera Error</p>
                <p className="text-text-secondary text-sm max-w-xs">{cameraError}</p>
                <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-dark-800 rounded-lg text-xs hover:bg-dark-700 transition-colors border border-dark-700">Try Again</button>
              </div>
            )}

            {/* EAR indicator */}
            {cameraReady && (
              <div className="absolute top-3 right-3 bg-dark-900/80 backdrop-blur rounded-lg px-3 py-2">
                <p className="text-xs text-text-muted mb-0.5">Eye State</p>
                <div className={`flex items-center gap-2 ${isEyeClosed ? 'text-accent-rose' : 'text-accent-teal'}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'currentColor' }} />
                  <span className="text-xs font-mono">{isEyeClosed ? 'CLOSED' : 'OPEN'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Step instruction */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-violet/10 border border-accent-violet/20 mb-3">
              <span className="text-accent-violet font-mono text-sm font-medium">STEP {step}</span>
            </div>
            <h3 className="font-display text-xl font-semibold mb-1">{STEPS[step - 1].title}</h3>
            <p className="text-text-secondary text-sm">{STEPS[step - 1].subtitle}</p>

            {step === 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i}
                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all
                                 ${i < blinkCount
                        ? 'bg-accent-violet/20 border-accent-violet text-accent-violet'
                        : 'border-dark-600 text-text-muted'}`}>
                    {i < blinkCount ? '✓' : i + 1}
                  </div>
                ))}
              </div>
            )}

            {step === 2 && dashMs && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-teal/10 border border-accent-teal/20">
                <span className="text-accent-teal font-mono">{dashMs}ms</span>
                <span className="text-text-secondary text-sm">— dash threshold</span>
              </div>
            )}

            {step === 3 && (
              <div className="mt-4 space-y-3">
                <p className="text-text-muted text-xs">Morse for "HI": <span className="font-mono text-accent-cyan">···· ··</span></p>
                <div className="font-mono text-lg text-accent-cyan tracking-widest">{morseBuffer || '...'}</div>
                <button className="btn-primary px-6 py-3" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save & Continue to Dashboard →'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-text-muted text-xs mt-4">
          You can re-calibrate anytime from Settings
        </p>
      </div>
    </div>
  );
}