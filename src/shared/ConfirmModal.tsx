"use client";

import React from 'react';
import { Modal } from '@/shared/Modal/Modal';
import { Button } from '@/shared/Button';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for destructive actions like Delete */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The same "Are you sure...?" modal the delete flow used, made reusable.
 */
export const ConfirmModal = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel
}: ConfirmModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={loading ? () => {} : onCancel} title={title}>
      <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
      <div className="flex gap-4">
        <Button variant="secondary" onClick={onCancel} disabled={loading} className="flex-1 !py-3">
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 !py-3"
        >
          {loading ? 'Please wait...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};