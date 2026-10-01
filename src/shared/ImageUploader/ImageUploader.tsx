"use client";

import React, { useState, useRef, DragEvent as ReactDragEvent } from 'react';
import { IonIcon } from '@ionic/react';
import { cloudUploadOutline, closeCircle, star } from 'ionicons/icons';
import { Skeleton } from '@/shared/Skeleton/Skeleton';

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  onError: (message: string) => void;
  maxImages?: number;
  onUploadingStateChange?: (isUploading: boolean) => void;
}

export const ImageUploader = ({ images, onChange, onError, maxImages = 5, onUploadingStateChange }: ImageUploaderProps) => {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<{ id: string, progress: number, preview: string }[]>([]);
  const [loadedImages, setLoadedImages] = useState<{ [key: string]: boolean }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Client-Side Compression
  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1000;
          const scaleSize = MAX_WIDTH / img.width;
          canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
          canvas.height = img.width > MAX_WIDTH ? img.height * scaleSize : img.height;
          
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          canvas.toBlob((blob) => {
            if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
            else resolve(file);
          }, 'image/jpeg', 0.8);
        };
      };
    });
  };

  // 2. Batch Upload Logic
  const handleUpload = async (files: FileList | File[]) => {
    if (images.length + files.length > maxImages) {
      onError(`You can only upload a maximum of ${maxImages} images.`);
      return;
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      onError("Cloudinary credentials are missing in .env.local.");
      return;
    }

    onUploadingStateChange?.(true);

    const filesArray = Array.from(files);
    const trackingData = filesArray.map(rawFile => ({
      id: Math.random().toString(36).substring(7),
      rawFile,
      preview: URL.createObjectURL(rawFile)
    }));

    setUploadingFiles(prev => [...prev, ...trackingData.map(f => ({ id: f.id, progress: 0, preview: f.preview }))]);

    const uploadPromises = trackingData.map(async (fileData) => {
      try {
        const compressedFile = await compressImage(fileData.rawFile);
        
        return new Promise<string>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
          
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const progress = Math.round((e.loaded / e.total) * 100);
              setUploadingFiles(prev => prev.map(f => f.id === fileData.id ? { ...f, progress } : f));
            }
          };

          xhr.onload = () => {
            setUploadingFiles(prev => prev.filter(f => f.id !== fileData.id));
            if (xhr.status === 200) {
              const response = JSON.parse(xhr.responseText);
              resolve(response.secure_url);
            } else {
              resolve(''); 
            }
          };

          xhr.onerror = () => {
            setUploadingFiles(prev => prev.filter(f => f.id !== fileData.id));
            resolve('');
          };

          const formData = new FormData();
          formData.append('file', compressedFile);
          formData.append('upload_preset', uploadPreset);
          xhr.send(formData);
        });
      } catch (error) {
        setUploadingFiles(prev => prev.filter(f => f.id !== fileData.id));
        return '';
      }
    });

    const results = await Promise.all(uploadPromises);
    const successfulUrls = results.filter(url => url !== '');
    
    if (successfulUrls.length > 0) {
      onChange([...images, ...successfulUrls]);
    }
    
    onUploadingStateChange?.(false);
  };

  // 3. Handlers
  const onDragOverFile = (e: ReactDragEvent) => { e.preventDefault(); setIsDraggingFile(true); };
  const onDragLeaveFile = () => setIsDraggingFile(false);
  const onDropFile = (e: ReactDragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleSortDragStart = (index: number) => setDraggedImageIndex(index);
  const handleSortDragOver = (e: ReactDragEvent) => e.preventDefault();
  
  const handleSortDrop = (targetIndex: number) => {
    if (draggedImageIndex === null || draggedImageIndex === targetIndex) return;
    const newImages = [...images];
    const [draggedItem] = newImages.splice(draggedImageIndex, 1);
    newImages.splice(targetIndex, 0, draggedItem);
    onChange(newImages);
    setDraggedImageIndex(null);
  };

  const removeImage = (indexToRemove: number) => {
    onChange(images.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div className="space-y-4">
      
      {images.length < maxImages && (
        <div 
          onDragOver={onDragOverFile} onDragLeave={onDragLeaveFile} onDrop={onDropFile}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
            isDraggingFile ? 'bg-orange-500/10' : 'bg-transparent hover:bg-orange-500/5'
          }`}
        >
          <input 
            type="file" multiple accept="image/*" className="hidden" ref={fileInputRef}
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          <div className="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-4 text-orange-500">
            <IonIcon icon={cloudUploadOutline} className="text-3xl" />
          </div>
          <p className="font-bold text-gray-900 dark:text-white">Tap or Drag & Drop to Upload</p>
          <p className="text-sm text-gray-500 mt-1">Up to {maxImages} images. Drag images below to rearrange.</p>
        </div>
      )}

      {uploadingFiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {uploadingFiles.map(file => (
            <div key={file.id} className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800">
              <img src={file.preview} alt="Uploading..." className="w-full h-full object-cover opacity-50 blur-sm" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                <IonIcon icon={cloudUploadOutline} className="text-white text-2xl mb-2 animate-bounce" />
                <div className="w-full bg-gray-200/50 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-orange-500 h-1.5 transition-all duration-300" style={{ width: `${file.progress}%` }}></div>
                </div>
                <span className="text-white text-xs font-bold mt-1">{file.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {images.map((url, idx) => (
            <div 
              key={url + idx} 
              draggable
              onDragStart={() => handleSortDragStart(idx)}
              onDragOver={handleSortDragOver}
              onDrop={() => handleSortDrop(idx)}
              className={`relative aspect-square rounded-2xl overflow-hidden group border-2 cursor-grab active:cursor-grabbing transition-transform bg-gray-100 dark:bg-gray-800 ${
                idx === 0 ? 'border-[#D4AF37]' : 'border-transparent'
              } ${draggedImageIndex === idx ? 'opacity-50 scale-95' : 'opacity-100'}`}
            >
              {!loadedImages[url] && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
              <img 
                src={url} 
                alt="Product" 
                onLoad={() => setLoadedImages(prev => ({ ...prev, [url]: true }))}
                className={`w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${loadedImages[url] ? 'opacity-100' : 'opacity-0'}`} 
              />
              
              {idx === 0 && (
                <div className="absolute bottom-2 left-2 bg-[#D4AF37] text-white text-[9px] px-2 py-0.5 rounded-full font-black tracking-wider uppercase shadow-md flex items-center gap-1 z-10">
                  <IonIcon icon={star} /> Cover
                </div>
              )}

              {/* Permanent floating cross icon (no background box) */}
              <button 
                onClick={(e) => { e.stopPropagation(); removeImage(idx); }} 
                className="absolute top-1 right-1 text-white/90 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] hover:text-red-500 active:scale-90 transition-all z-20"
                title="Delete Image"
              >
                <IonIcon icon={closeCircle} className="text-[28px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};