"use client";
import { useState } from 'react';
import { Modal } from '@/shared/Modal';
import { Button } from '@/shared/Button';

export default function ExamplePage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setIsModalOpen(true)}>Open Action</Button>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Action Required"
      >
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Are you sure you want to proceed with this action? This cannot be undone.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setIsModalOpen(false)} className="flex-1">
            Cancel
          </Button>
          <Button className="flex-1">
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  );
}
//set NODE_OPTIONS=--max-old-space-size=1536 && npx next dev --webpack