"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";

type UploadedImage = { id: string; url: string; createdAt: string };

type Props = {
  receivedUnitId: string;
  unitTitle: string;
  unitIndex: number;
  onClose: () => void;
};

export default function ImageUploadPanel({ receivedUnitId, unitTitle, unitIndex, onClose }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountRef = useRef(0);

  const createSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/uploads/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedUnitId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");

      const sid = data.sessionId;
      setSessionId(sid);

      // Generate QR code pointing to the mobile upload page
      const uploadUrl = `${window.location.origin}/upload/${sid}`;
      const qr = await QRCode.toDataURL(uploadUrl, {
        width: 240,
        margin: 2,
        color: { dark: "#1e293b", light: "#f8fafc" },
      });
      setQrDataUrl(qr);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [receivedUnitId]);

  // Poll for new images every 2.5 seconds
  const startPolling = useCallback((sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/uploads/session/${sid}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.images?.length !== lastCountRef.current) {
          lastCountRef.current = data.images.length;
          setImages(data.images);
        }
      } catch {}
    }, 2500);
  }, []);

  useEffect(() => {
    createSession();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [createSession]);

  useEffect(() => {
    if (sessionId) startPolling(sessionId);
  }, [sessionId, startPolling]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Add Photos — Unit #{unitIndex}</h3>
            <p className="text-xs text-slate-500 truncate max-w-[280px]" title={unitTitle}>{unitTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <div className="text-center py-8 text-slate-500 text-sm animate-pulse">
              Generating QR code...
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">
              {error}
              <button onClick={createSession} className="ml-2 underline text-xs">Retry</button>
            </div>
          )}

          {qrDataUrl && !loading && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-center">
                <p className="text-sm text-slate-300 font-medium mb-1">Scan with your phone</p>
                <p className="text-xs text-slate-500">Opens the photo upload page</p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Upload QR Code"
                className="rounded-xl border-4 border-slate-100 w-48 h-48"
              />
            </div>
          )}

          {/* Uploaded images */}
          {images.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-400 font-medium">
                  ✓ {images.length} photo{images.length !== 1 ? "s" : ""} received
                </span>
                <span className="text-xs text-slate-600">— updating in real time</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {images.map((img) => (
                  <div key={img.id} className="aspect-square rounded-lg overflow-hidden bg-slate-800 ring-1 ring-slate-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="Unit photo" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            !loading && (
              <div className="text-center py-2">
                <p className="text-xs text-slate-600">Waiting for photos...</p>
                <div className="mt-1 flex justify-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </div>
              </div>
            )
          )}

          {images.length > 0 && (
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              Done — {images.length} photo{images.length !== 1 ? "s" : ""} saved
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
