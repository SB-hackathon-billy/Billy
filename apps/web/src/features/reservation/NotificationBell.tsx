// 머리말 알림 버튼과 읽지 않은 수. 명세 0004.
import { Link } from 'react-router-dom';
import { useNotifications } from './data.js';

export function NotificationBell() {
  const notifications = useNotifications();
  const unread = notifications.data?.unreadCount ?? 0;
  return (
    <Link
      className="header-icon"
      to="/notifications"
      aria-label={unread ? `알림 ${unread}개 안 읽음` : '알림'}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
        <path d="M10 20a2.2 2.2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="header-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
