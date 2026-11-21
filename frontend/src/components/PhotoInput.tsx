import React, { useState } from 'react';
import { Camera, X } from 'lucide-react';

interface PhotoInputProps {
  label?: string;
  onFileSelect: (file: File | null) => void;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({ label = 'Capturar / Anexar Foto', onFileSelect }) => {
  const [preview, setPreview] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    onFileSelect(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-400 cursor-pointer text-sm font-medium text-slate-700 transition">
        <Camera className="w-4 h-4 text-blue-600" />
        <span>{label}</span>
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} />
      </label>
      {preview && (
        <div className="relative inline-block">
          <img src={preview} alt="Prévia" className="h-24 w-32 object-cover rounded-lg border border-slate-200" />
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              onFileSelect(null);
            }}
            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 shadow"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
