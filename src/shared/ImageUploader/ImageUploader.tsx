"use client";

import React, { useState, useRef, DragEvent as ReactDragEvent } from 'react';
import { IonIcon } from '@ionic/react';
import { cloudUploadOutline, trashOutline, star } from 'ionicons/icons';

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  onError: (message: string) => void;
  maxImages?: number;
}

export const ImageUploader = ({ images, onChange, onError, maxImages = 5 }: ImageUploaderProps) => {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<{ id: string, progress: number, preview: string }[]>([]);
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

  // 2. Batch Upload Logic (Fixes the vanishing image bug)
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

    const filesArray = Array.from(files);
    const trackingData = filesArray.map(rawFile => ({
      id: Math.random().toString(36).substring(7),
      rawFile,
      preview: URL.createObjectURL(rawFile)
    }));

    setUploadingFiles(prev => [...prev, ...trackingData.map(f => ({ id: f.id, progress: 0, preview: f.preview }))]);

    // Process all uploads as an array of promises
    const uploadPromises = trackingData.map(async (fileData) => {
      try {
        const compressedFile = await compressImage(fileData.rawFile);
        
        return new Promise<string>((resolve, reject) => {
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
              try {
                const errResponse = JSON.parse(xhr.responseText);
                console.error("Cloudinary Error:", errResponse);
                onError(`Upload failed: ${errResponse.error?.message}`);
              } catch {
                onError(`Upload failed with status: ${xhr.status}`);
              }
              resolve(''); // Resolve empty string to prevent Promise.all from failing entirely
            }
          };

          xhr.onerror = () => {
            setUploadingFiles(prev => prev.filter(f => f.id !== fileData.id));
            onError("Network error during upload.");
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

    // Wait for all uploads to finish, then update the array exactly ONCE
    const results = await Promise.all(uploadPromises);
    const successfulUrls = results.filter(url => url !== '');
    
    if (successfulUrls.length > 0) {
      onChange([...images, ...successfulUrls]);
    }
  };

  // 3. File Dropzone Handlers
  const onDragOverFile = (e: ReactDragEvent) => { e.preventDefault(); setIsDraggingFile(true); };
  const onDragLeaveFile = () => setIsDraggingFile(false);
  const onDropFile = (e: ReactDragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // 4. Image Rearrangement Handlers (Drag & Drop Sorting)
  const handleSortDragStart = (index: number) => {
    setDraggedImageIndex(index);
  };

  const handleSortDragOver = (e: ReactDragEvent) => {
    e.preventDefault(); // Necessary to allow dropping
  };

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
      
      {/* Upload Dropzone */}
      {images.length < maxImages && (
        <div 
          onDragOver={onDragOverFile} onDragLeave={onDragLeaveFile} onDrop={onDropFile}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
            isDraggingFile ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/10' : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-[#1e293b]'
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

      {/* Uploading Progress Previews */}
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

      {/* Uploaded Images Grid (Drag and Drop enabled) */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {images.map((url, idx) => (
            <div 
              key={url + idx} 
              draggable
              onDragStart={() => handleSortDragStart(idx)}
              onDragOver={handleSortDragOver}
              onDrop={() => handleSortDrop(idx)}
              className={`relative aspect-square rounded-2xl overflow-hidden group border-2 cursor-grab active:cursor-grabbing transition-transform ${
                idx === 0 ? 'border-[#D4AF37]' : 'border-transparent'
              } ${draggedImageIndex === idx ? 'opacity-50 scale-95' : 'opacity-100'}`}
            >
              <img src={url} alt="Product" className="w-full h-full object-cover pointer-events-none" />
              
              {/* Cover Photo Badge */}
              {idx === 0 && (
                <div className="absolute top-2 left-2 bg-[#D4AF37] text-white text-[9px] px-2 py-0.5 rounded-full font-black tracking-wider uppercase shadow-md flex items-center gap-1">
                  <IonIcon icon={star} /> Cover
                </div>
              )}

              {/* Delete Button Overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex p-2">
                <button 
                  onClick={() => removeImage(idx)} 
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
                  title="Delete Image"
                >
                  <IonIcon icon={trashOutline} className="text-lg" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};