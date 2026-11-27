import React, { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, X } from 'lucide-react';

interface PhotoInputProps {
  label?: string;
  onFileSelect: (file: File | null) => void;
  file?: File | null;
  cameraOnly?: boolean;
  facingMode?: 'user' | 'environment';
  large?: boolean;
}

/**
 * Redimensiona a foto preservando qualidade HD (máx 2560px, JPEG 92%)
 * para nitidez em etiquetas/gôndolas e envio em HD ao Telegram.
 */
async function compressImageFile(file: File, maxSize = 2560, quality = 0.92): Promise<{ compressed: File; previewUrl: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ compressed: file, previewUrl: dataUrl });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ compressed: file, previewUrl: dataUrl });
              return;
            }
            const baseName = (file.name || 'foto').replace(/\.[^.]+$/, '');
            const compressedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
            resolve({ compressed: compressedFile, previewUrl: compressedUrl });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve({ compressed: file, previewUrl: dataUrl });
      img.src = dataUrl;
    };
    reader.onerror = () => resolve({ compressed: file, previewUrl: '' });
    reader.readAsDataURL(file);
  });
}

export const PhotoInput: React.FC<PhotoInputProps> = ({
  label = 'Capturar / Anexar Foto',
  onFileSelect,
  file,
  cameraOnly = false,
  facingMode = 'environment',
  large = false,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file === null) {
      setPreview(null);
      setCapturedAt(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [file]);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (!selected) {
      onFileSelect(null);
      setPreview(null);
      setCapturedAt(null);
      return;
    }
    const { compressed, previewUrl } = await compressImageFile(selected);
    setCapturedAt(new Date().toLocaleString('pt-BR'));
    setPreview(previewUrl || null);
    onFileSelect(compressed);
  };

  const clearSelection = () => {
    setPreview(null);
    setCapturedAt(null);
    if (inputRef.current) inputRef.current.value = '';
    onFileSelect(null);
  };

  const captureAttr = cameraOnly ? facingMode : undefined;

  return (
    <div className="space-y-2">
      {!preview ? (
        <label
          className={`flex items-center justify-center gap-2.5 border-2 border-dashed border-blue-300 rounded-2xl bg-blue-50/50 hover:bg-blue-50 hover:border-blue-500 cursor-pointer font-semibold text-blue-800 transition ${
            large ? 'px-4 py-5 text-base' : 'px-3 py-2.5 text-sm'
          }`}
        >
          <Camera className={large ? 'w-6 h-6 text-blue-600' : 'w-4 h-4 text-blue-600'} />
          <span>{label}</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture={captureAttr}
            className="hidden"
            onChange={handleChange}
          />
        </label>
      ) : (
        <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
          <div className="relative inline-block w-full">
            <img
              src={preview}
              alt="Prévia da fotografia"
              className={`w-full object-cover rounded-xl border border-slate-200 ${large ? 'max-h-64' : 'h-28 w-36'}`}
            />
            <button
              type="button"
              onClick={clearSelection}
              title="Remover foto"
              className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1.5 shadow hover:bg-red-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span>Capturada em: <b>{capturedAt}</b></span>
            <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-bold cursor-pointer hover:bg-amber-200">
              <RotateCcw className="w-3.5 h-3.5" />
              Refazer Foto
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                capture={captureAttr}
                className="hidden"
                onChange={handleChange}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
