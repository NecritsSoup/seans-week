import { useEffect } from 'react';
import { useToast } from './Toast';
import { subscribeToastRequests } from './toastBus';

/** Forwards toast requests from non-React modules onto the toast stack. */
export function ToastBridge() {
  const { showToast } = useToast();
  useEffect(() => subscribeToastRequests((request) => showToast(request)), [showToast]);
  return null;
}
