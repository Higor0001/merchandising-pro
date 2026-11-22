import React, { useEffect, useState } from 'react';
import { Camera, RotateCcw, X } from 'lucide-react';

interface PhotoInputProps {
  label?: string;
  onFileSelect: (file: File | null) => void;
  file?: File | null;
  cameraOnly?: boolean;
  large?: boolean;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({
  label = 'Capturar / Anexar Foto',
  onFileSelect,
  file,
  cameraOnly = false,
  large = false,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  useEffect(() => {
    if (file === null) {
      setPreview(null);
      setCapturedAt(null);
    }
  }, [file]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    onFileSelect(selected);
    if (selected) {
      setCapturedAt(new Date().toLocaleString('pt-BR'));
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(selected);
    } else {
      setPreview(null);
      setCapturedAt(null);
    }
  };

  const clearSelection = () => {
    setPreview(null);
    setCapturedAt(null);
    onFileSelect(null);
  };

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
            type="file"
            accept="image/*"
            capture={cameraOnly ? 'environment' : 'environment'}
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
                accept="image/*"
                capture="environment"
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
