import React from 'react';
import { IonIcon } from '@ionic/react';
import { closeOutline, backspaceOutline } from 'ionicons/icons';

interface PinPadModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinMode: 'create' | 'confirm' | 'verify';
  pin: string;
  totalCharge: number;
  onPinPress: (digit: string) => void;
  onBackspace: () => void;
}

export const PinPadModal = ({ isOpen, onClose, pinMode, pin, totalCharge, onPinPress, onBackspace }: PinPadModalProps) => {
  return (
    <>
      {isOpen && <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />}
      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black">
              {pinMode === 'create' ? 'Create Transaction PIN' : 
               pinMode === 'confirm' ? 'Confirm Your PIN' : 
               'Enter Transaction PIN'}
            </h3>
            <button onClick={onClose} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
              <IonIcon icon={closeOutline} />
            </button>
          </div>
          
          <p className="text-center text-gray-500 text-sm mb-10">
            {pinMode === 'create' ? 'Set a 4-digit PIN to secure your wallet transactions.' : 
             pinMode === 'confirm' ? 'Enter the same 4-digit PIN again to confirm.' : 
             `Enter your 4-digit PIN to authorize ₦${totalCharge.toLocaleString()}.`}
          </p>

          <div className="flex justify-center gap-6 mb-12">
            {[0, 1, 2, 3].map((index) => (
              <div 
                key={index} 
                className={`w-4 h-4 rounded-full transition-all duration-300 ${
                  index < pin.length 
                    ? 'bg-orange-500 scale-110 shadow-[0_0_12px_rgba(249,115,22,0.6)]' 
                    : 'bg-gray-200 dark:bg-gray-700 scale-100'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-y-6 gap-x-4 max-w-[280px] mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button 
                key={num} 
                onClick={() => onPinPress(num.toString())}
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {num}
              </button>
            ))}
            <div /> 
            <button 
              onClick={() => onPinPress('0')}
              className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              0
            </button>
            <button 
              onClick={onBackspace}
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
            >
              <IonIcon icon={backspaceOutline} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};