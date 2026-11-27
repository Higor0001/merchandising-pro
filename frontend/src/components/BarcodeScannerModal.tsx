import React, { useEffect, useId, useRef, useState } from 'react';
import { Barcode, Camera, X } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (ean: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ open, onClose, onDetected }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCloseRef = useRef(onClose);
  const onDetectedRef = useRef(onDetected);
  const [manualEan, setManualEan] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [useFallbackLib, setUseFallbackLib] = useState(false);
  const readerDomId = useId().replace(/:/g, '_');

  useEffect(() => {
    onCloseRef.current = onClose;
    onDetectedRef.current = onDetected;
  }, [onClose, onDetected]);

  useEffect(() => {
    if (!open) return;

    setCameraError('');
    const hasNativeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    setUseFallbackLib(!hasNativeDetector);

    let active = true;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let html5Scanner: Html5Qrcode | null = null;

    async function startNative() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        // @ts-ignore - BarcodeDetector API disponível em Chromium
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
        const scanLoop = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              active = false;
              onDetectedRef.current(codes[0].rawValue);
              onCloseRef.current();
              return;
            }
          } catch {
            // ignore frame errors
          }
          if (active) rafId = requestAnimationFrame(scanLoop);
        };
        rafId = requestAnimationFrame(scanLoop);
      } catch {
        if (active) setCameraError('Câmera indisponível neste dispositivo. Digite o código EAN abaixo.');
      }
    }

    async function startFallback() {
      // Aguarda o div do leitor montar no DOM
      await new Promise((r) => setTimeout(r, 80));
      if (!active) return;
      const el = document.getElementById(`barcode-reader-${readerDomId}`);
      if (!el) return;

      try {
        html5Scanner = new Html5Qrcode(`barcode-reader-${readerDomId}`, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
        });
        await html5Scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 110 } },
          (decodedText) => {
            if (!active || !decodedText) return;
            active = false;
            onDetectedRef.current(decodedText);
            onCloseRef.current();
          },
          () => {
            // ignore per-frame scan misses
          }
        );
      } catch {
        if (active) setCameraError('Câmera indisponível neste navegador. Digite o código EAN abaixo.');
      }
    }

    if (hasNativeDetector) void startNative();
    else void startFallback();

    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (html5Scanner) {
        html5Scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              html5Scanner?.clear();
            } catch {
              // ignore
            }
          });
      }
    };
  }, [open, readerDomId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Barcode className="w-5 h-5 text-blue-600" />
            <span>Leitor de Código de Barras (EAN)</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {cameraError ? (
          <div className="p-4 bg-amber-50 text-amber-800 rounded-xl text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 shrink-0" />
            <span>{cameraError}</span>
          </div>
        ) : useFallbackLib ? (
          <div className="rounded-xl overflow-hidden bg-black min-h-[200px]">
            <div id={`barcode-reader-${readerDomId}`} className="w-full" />
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80 shadow" />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualEan.trim()) {
              onDetected(manualEan.trim());
              setManualEan('');
              onClose();
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={manualEan}
            onChange={(e) => setManualEan(e.target.value)}
            placeholder="Ou digite o EAN (ex: 7891000100101)"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
            Buscar
          </button>
        </form>
      </div>
    </div>
  );
};
