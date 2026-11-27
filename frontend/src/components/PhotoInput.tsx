import React, { useEffect, useRef, useState } from 'react';
import { Camera, Images, RefreshCw, RotateCcw, X } from 'lucide-react';

interface PhotoInputProps {
  label?: string;
  onFileSelect?: (file: File | null) => void;
  onFilesSelect?: (files: File[]) => void;
  file?: File | null;
  cameraOnly?: boolean;
  multiple?: boolean;
  autoClear?: boolean;
  busy?: boolean;
  busyText?: string;
  facingMode?: 'user' | 'environment';
  large?: boolean;
}

/**
 * Redimensiona a foto preservando qualidade HD (máx 2560px; panorâmicas até 4096px, JPEG 92%)
 * para nitidez em etiquetas/gôndolas, fotos panorâmicas e envio em HD ao Telegram.
 */
async function compressImageFile(
  file: File,
  maxSize = 2560,
  quality = 0.92
): Promise<{ compressed: File; previewUrl: string; isPanoramic: boolean }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const aspect = width > 0 && height > 0 ? Math.max(width / height, height / width) : 1;
        const isPanoramic = aspect >= 2.0;
        const effectiveMax = isPanoramic ? Math.max(maxSize, 4096) : maxSize;
        if (width > effectiveMax || height > effectiveMax) {
          if (width >= height) {
            height = Math.round((height * effectiveMax) / width);
            width = effectiveMax;
          } else {
            width = Math.round((width * effectiveMax) / height);
            height = effectiveMax;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ compressed: file, previewUrl: dataUrl, isPanoramic });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ compressed: file, previewUrl: dataUrl, isPanoramic });
              return;
            }
            const baseName = (file.name || 'foto').replace(/\.[^.]+$/, '');
            const compressedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
            resolve({ compressed: compressedFile, previewUrl: compressedUrl, isPanoramic });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve({ compressed: file, previewUrl: dataUrl, isPanoramic: false });
      img.src = dataUrl;
    };
    reader.onerror = () => resolve({ compressed: file, previewUrl: '', isPanoramic: false });
    reader.readAsDataURL(file);
  });
}

export const PhotoInput: React.FC<PhotoInputProps> = ({
  label = 'Capturar / Anexar Foto',
  onFileSelect,
  onFilesSelect,
  file,
  cameraOnly = false,
  multiple = false,
  autoClear = false,
  busy = false,
  busyText = 'Enviando foto(s) em HD...',
  facingMode = 'environment',
  large = false,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [isPanoramicPreview, setIsPanoramicPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file === null) {
      setPreview(null);
      setCapturedAt(null);
      setIsPanoramicPreview(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [file]);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) {
      onFileSelect?.(null);
      setPreview(null);
      setCapturedAt(null);
      setIsPanoramicPreview(false);
      return;
    }

    const processed = await Promise.all(fileList.map((f) => compressImageFile(f)));
    const compressedFiles = processed.map((p) => p.compressed);

    if (autoClear || multiple) {
      if (inputRef.current) inputRef.current.value = '';
      setPreview(null);
      setCapturedAt(null);
      setIsPanoramicPreview(false);
      if (onFilesSelect) {
        onFilesSelect(compressedFiles);
      } else if (onFileSelect && compressedFiles[0]) {
        onFileSelect(compressedFiles[0]);
      }
      return;
    }

    setCapturedAt(new Date().toLocaleString('pt-BR'));
    setPreview(processed[0].previewUrl || null);
    setIsPanoramicPreview(Boolean(processed[0].isPanoramic));
    onFileSelect?.(compressedFiles[0]);
    onFilesSelect?.(compressedFiles);
  };

  const clearSelection = () => {
    setPreview(null);
    setCapturedAt(null);
    setIsPanoramicPreview(false);
    if (inputRef.current) inputRef.current.value = '';
    onFileSelect?.(null);
  };

  // Quando multiple=true, não usar capture para permitir seleção de várias fotos no celular
  const captureAttr = !multiple && cameraOnly ? facingMode : undefined;

  return (
    <div className="space-y-2">
      {!preview ? (
        <label
          className={`flex items-center justify-center gap-2.5 border-2 border-dashed rounded-2xl font-semibold transition ${
            busy
              ? 'border-emerald-400 bg-emerald-50 text-emerald-800 cursor-wait'
              : 'border-blue-300 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-500 text-blue-800 cursor-pointer'
          } ${large ? 'px-4 py-4 text-sm sm:text-base' : 'px-3 py-2.5 text-xs sm:text-sm'}`}
        >
          {busy ? (
            <RefreshCw className={`${large ? 'w-5 h-5' : 'w-4 h-4'} animate-spin text-emerald-600`} />
          ) : multiple ? (
            <Images className={large ? 'w-5 h-5 text-blue-600' : 'w-4 h-4 text-blue-600'} />
          ) : (
            <Camera className={large ? 'w-5 h-5 text-blue-600' : 'w-4 h-4 text-blue-600'} />
          )}
          <span>{busy ? busyText : label}</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture={captureAttr}
            multiple={multiple}
            disabled={busy}
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
              className={`w-full ${isPanoramicPreview ? 'object-contain bg-slate-900/5 max-h-52' : 'object-cover'} rounded-xl border border-slate-200 ${large ? 'max-h-64' : isPanoramicPreview ? 'h-28' : 'h-28 w-36'}`}
            />
            {isPanoramicPreview && (
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-indigo-600/90 text-white text-[10px] font-extrabold shadow">
                Panorâmica HD
              </span>
            )}
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
