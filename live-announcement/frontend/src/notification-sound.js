const audio = new Audio('data:audio/wav;base64,UklGRhYAAABXQVZFZm10IBIAAABIAAgAZGF0YQAAAAA=');
export function playNotificationSound() {
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
