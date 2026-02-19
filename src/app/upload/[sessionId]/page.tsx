"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

type SessionImage = { id: string; url: string; createdAt: string };
type SessionInfo = {
  sessionId: string;
  expiresAt: string;
  unit: { id: string; unitIndex: number; title: string; condition: string; orderId: string };
  images: SessionImage[];
};

export default function UploadPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadSession() {
    try {
      const res = await fetch(`/api/uploads/session/${sessionId}`);
      if (!res.ok) {
        const d = await res.json();
        setError(d.error === "Session expired" ? "This upload session has expired." : "Invalid session.");
        return;
      }
      const data: SessionInfo = await res.json();
      setSession(data);
    } catch {
      setError("Failed to load session.");
    }
  }

  useEffect(() => {
    loadSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !session) return;
    setUploading(true);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("photo", files[i]);
    }

    try {
      const res = await fetch(`/api/uploads/session/${sessionId}/photos`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadedCount((c) => c + (data.uploaded?.length ?? 0));
        setSession((prev) => prev ? { ...prev, images: data.images } : prev);
      } else {
        setError(data.error ?? "Upload failed.");
      }
    } catch {
      setError("Upload failed. Check your connection.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const conditionBadgeColor = (cond: string) => {
    const good = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
    return good.has(cond) ? "bg-green-800 text-green-200" : "bg-red-800 text-red-200";
  };

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="text-4xl">⚠️</div>
          <p className="text-red-400 text-lg font-medium">{error}</p>
          <p className="text-slate-500 text-sm">Ask the receiver to generate a new QR code.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  const { unit, images } = session;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 max-w-lg mx-auto space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 font-mono">Order {unit.orderId}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${conditionBadgeColor(unit.condition)}`}>
            {unit.condition.replace(/_/g, " ")}
          </span>
        </div>
        <p className="text-sm font-semibold text-slate-200 leading-snug">{unit.title}</p>
        <p className="text-xs text-slate-400">Unit #{unit.unitIndex}</p>
      </div>

      {/* Upload buttons */}
      <div className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          id="camera-input"
        />
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          id="library-input"
        />

        <label
          htmlFor="camera-input"
          className={`flex items-center justify-center gap-3 w-full rounded-xl py-4 text-base font-semibold cursor-pointer transition-colors ${
            uploading
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white active:bg-blue-700"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {uploading ? "Uploading..." : "Take Photo"}
        </label>

        <label
          htmlFor="library-input"
          className={`flex items-center justify-center gap-3 w-full rounded-xl py-3.5 text-base font-semibold cursor-pointer transition-colors border ${
            uploading
              ? "border-slate-700 text-slate-500 cursor-not-allowed"
              : "border-slate-600 text-slate-300 hover:bg-slate-800 active:bg-slate-700"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Choose from Library
        </label>
      </div>

      {/* Uploaded photos */}
      {images.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
            {images.length} photo{images.length !== 1 ? "s" : ""} uploaded
          </p>
          <div className="grid grid-cols-3 gap-2">
            {images.map((img) => (
              <div key={img.id} className="aspect-square rounded-lg overflow-hidden bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt="Uploaded"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-green-400 text-center">
            ✓ Photos are visible on the workstation in real time
          </p>
        </div>
      )}

      {uploadedCount > 0 && images.length === 0 && (
        <p className="text-center text-sm text-green-400">
          ✓ {uploadedCount} photo{uploadedCount !== 1 ? "s" : ""} uploaded
        </p>
      )}

      <p className="text-center text-xs text-slate-600 pb-4">
        Session expires {new Date(session.expiresAt).toLocaleString()}
      </p>
    </div>
  );
}
