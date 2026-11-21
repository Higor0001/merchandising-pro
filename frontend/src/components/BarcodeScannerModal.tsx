import React, { useEffect, useRef, useState } from 'react';
import { Barcode, Camera, X } from 'lucide-react';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (ean: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ open, onClose, onDetected }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualEan, setManualEan] = useState('');
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let active = true;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current && active) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if ('BarcodeDetector' in window) {
          // @ts-ignore
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'] });
          const scanLoop = async () => {
            if (!active || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0 && codes[0].rawValue) {
                onDetected(codes[0].rawValue);
                onClose();
                return;
              }
            } catch {
              // ignore frame errors
            }
            if (active) requestAnimationFrame(scanLoop);
          };
          requestAnimationFrame(scanLoop);
        }
      } catch {
        setCameraError('Câmera indisponível neste dispositivo. Digite o código EAN abaixo.');
      }
    }

    startCamera();
    return () => {
      active = false;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Barcode className="w-5 h-5 text-blue-600" />
            <span>Leitor de Código de Barras (EAN)</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {cameraError ? (
          <div className="p-4 bg-amber-50 text-amber-800 rounded-xl text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 shrink-0" />
            <span>{cameraError}</span>
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
