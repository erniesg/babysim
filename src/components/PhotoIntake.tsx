import { useEffect, useRef, useState } from "react";
import "./PhotoIntake.css";

type Props = {
  onSubmitted: (kind: "uploaded" | "webcam" | "skipped") => void;
};

type Mode = "choose" | "webcam" | "upload" | "review";

export function PhotoIntake({ onSubmitted }: Props) {
  const [mode, setMode] = useState<Mode>("choose");
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<"uploaded" | "webcam" | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (mode !== "webcam") return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setStreamErr(err instanceof Error ? err.message : "Camera unavailable.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode]);

  function captureWebcam() {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(dataUrl);
    setSource("webcam");
    setMode("review");
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url) return;
      setPreview(url);
      setSource("uploaded");
      setMode("review");
    };
    reader.readAsDataURL(file);
  }

  function confirm() {
    if (!source) return;
    onSubmitted(source);
  }

  function reset() {
    setPreview(null);
    setSource(null);
    setMode("choose");
  }

  if (mode === "choose") {
    return (
      <div className="photo-intake">
        <div className="photo-intake-head">
          <span className="kicker">Photo intake</span>
          <h3>Submit a photo for the case file.</h3>
          <p className="dim">Photos are theatrical. They are not transmitted off-device. Skip is acceptable.</p>
        </div>
        <div className="photo-actions">
          <button className="primary" onClick={() => setMode("webcam")}>
            Use webcam
          </button>
          <button onClick={() => setMode("upload")}>Upload file</button>
          <button onClick={() => onSubmitted("skipped")}>Skip</button>
        </div>
      </div>
    );
  }

  if (mode === "webcam") {
    return (
      <div className="photo-intake">
        <div className="photo-intake-head">
          <span className="kicker">Webcam capture</span>
          <h3>Look approximately at the camera.</h3>
        </div>
        <div className="photo-frame">
          {streamErr ? (
            <div className="photo-error">
              <strong>Camera blocked.</strong>
              <p className="dim">{streamErr}</p>
            </div>
          ) : (
            <video ref={videoRef} className="photo-video" muted playsInline />
          )}
          <div className="photo-stamp">CASE FILE INTAKE</div>
        </div>
        <div className="photo-actions">
          <button className="primary" onClick={captureWebcam} disabled={!!streamErr}>
            Capture
          </button>
          <button onClick={reset}>Back</button>
          <button onClick={() => onSubmitted("skipped")}>Skip</button>
        </div>
      </div>
    );
  }

  if (mode === "upload") {
    return (
      <div className="photo-intake">
        <div className="photo-intake-head">
          <span className="kicker">File upload</span>
          <h3>Pick a photo from your device.</h3>
        </div>
        <label className="photo-drop">
          <input type="file" accept="image/*" onChange={onFile} />
          <span>Click to pick a photo (JPEG/PNG). The Ministry accepts what you give it.</span>
        </label>
        <div className="photo-actions">
          <button onClick={reset}>Back</button>
          <button onClick={() => onSubmitted("skipped")}>Skip</button>
        </div>
      </div>
    );
  }

  // review
  return (
    <div className="photo-intake">
      <div className="photo-intake-head">
        <span className="kicker">Review</span>
        <h3>Confirm and submit?</h3>
      </div>
      <div className="photo-frame">
        {preview && <img src={preview} alt="Case file photo preview" className="photo-preview" />}
        <div className="photo-stamp filed">SUBMITTED</div>
      </div>
      <div className="photo-actions">
        <button className="primary" onClick={confirm}>
          File this photo
        </button>
        <button onClick={reset}>Retake</button>
      </div>
    </div>
  );
}
