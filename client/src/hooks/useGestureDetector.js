// client/src/hooks/useGestureDetector.js
// Reusable MediaPipe Tasks Vision gesture detector (Industry Standard)
import { useEffect, useRef, useState, useCallback } from 'react';
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

export default function useGestureDetector(videoRef, canvasRef, {
  onGesture,
  enabled = true,
  debounceMs = 1200,
} = {}) {
  const [detectedSign, setDetectedSign] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [handsReady, setHandsReady] = useState(false);
  const [wordBuffer, setWordBuffer] = useState([]);

  const recognizerRef = useRef(null);
  const lastFireRef = useRef(0);
  const lastLabelRef = useRef('');
  const isMountedRef = useRef(true);
  const animationRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);

  const initModel = useCallback(async () => {
    if (!enabled) return;

    try {
      // Load the WASM binary (Industry standard, extremely fast, no Vite CommonJS errors)
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          // Pre-trained model that detects standard gestures (Thumb Up, Open Palm, Closed Fist, etc.)
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      recognizerRef.current = recognizer;
      if (isMountedRef.current) setHandsReady(true);
    } catch (err) {
      console.error('MediaPipe Tasks Vision init error:', err);
    }
  }, [enabled]);

  const predictFrame = useCallback(() => {
    if (!isMountedRef.current || !enabled || !recognizerRef.current || !videoRef.current) return;

    const video = videoRef.current;
    
    // Only predict when the video frame has actually updated
    if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const nowInMs = Date.now();
      
      // Perform the inference with proper error handling
      try {
        const results = recognizerRef.current.recognizeForVideo(video, nowInMs);
        
        if (results?.gestures?.length > 0) {
          const gesture = results.gestures[0][0]; // Get the most confident gesture
          const label = gesture?.categoryName;
          const score = gesture?.score;

          if (label && label !== "None" && label !== "") {
             if (isMountedRef.current) {
               setDetectedSign(label);
               setConfidence(score);
             }
             
             const now = Date.now();
             // Require 70%+ confidence and debounce to avoid spamming
             if (score > 0.70 && label !== lastLabelRef.current && now - lastFireRef.current > debounceMs) {
               lastLabelRef.current = label;
               lastFireRef.current = now;
               
               // Map standard ML labels to user-friendly ASL/Command equivalents
               let mappedLabel = label.toUpperCase();
               if (label === 'Thumb_Up') mappedLabel = 'YES';
               if (label === 'Thumb_Down') mappedLabel = 'NO';
               if (label === 'Open_Palm') mappedLabel = 'HELLO / STOP';
               if (label === 'Closed_Fist') mappedLabel = 'HELP';
               if (label === 'Pointing_Up') mappedLabel = 'WAIT';
               
               onGesture?.(mappedLabel, score);
               if (isMountedRef.current) {
                 setWordBuffer(prev => [...prev.slice(-4), mappedLabel]);
               }
               setTimeout(() => { if (isMountedRef.current) lastLabelRef.current = ''; }, debounceMs);
             }
          } else {
             if (isMountedRef.current) {
               setDetectedSign('');
               setConfidence(0);
             }
          }
        }
      } catch (err) {
        // Silently catch frame processing errors to prevent breaking the animation loop
        console.warn('Gesture recognition frame error:', err);
      }
    }
    
    // Loop the prediction continuously via requestAnimationFrame
    animationRef.current = requestAnimationFrame(predictFrame);
  }, [enabled, debounceMs, onGesture, videoRef, canvasRef]);

  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) {
       initModel().then(() => {
          if (isMountedRef.current) predictFrame();
       });
    }
    return () => {
      isMountedRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (recognizerRef.current) {
        try { recognizerRef.current.close(); } catch (e) {}
        recognizerRef.current = null;
      }
      setHandsReady(false);
      setDetectedSign('');
      setConfidence(0);
    };
  }, [enabled, initModel, predictFrame]);

  const clearBuffer = () => setWordBuffer([]);

  return { detectedSign, confidence, handsReady, wordBuffer, clearBuffer };
}