"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SupportNotification = {
  id: string;
  support_request_id: string;
  notification_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type NotificationsResponse = {
  success?: boolean;
  notifications?: SupportNotification[];
  unreadCount?: number;
  error?: string;
};

function formatNotificationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function SupportNotifications() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<SupportNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  const loadNotifications = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/support/notifications", {
        method: "GET",
        cache: "no-store",
      });

      const result = (await response.json()) as NotificationsResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to load notifications.");
      }

      setNotifications(result.notifications ?? []);
      setUnreadCount(result.unreadCount ?? 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load notifications."
      );
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications(true);

    // Refresh periodically and when the user returns to this browser tab.
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, 60_000);

    const handleFocus = () => {
      void loadNotifications();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadNotifications]);

  async function markAsRead(notification: SupportNotification) {
    if (notification.is_read) return true;

    setUpdatingId(notification.id);
    setError("");

    try {
      const response = await fetch("/api/support/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: notification.id }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to mark notification as read.");
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, is_read: true } : item
        )
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update notification."
      );
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleNotificationClick(notification: SupportNotification) {
    const marked = await markAsRead(notification);
    if (!marked) return;

    setIsOpen(false);
    router.push(
      `/recruiter/support?requestId=${encodeURIComponent(
        notification.support_request_id
      )}`
    );
  }

  async function markAllAsRead() {
    if (unreadCount === 0) return;

    setMarkingAll(true);
    setError("");

    try {
      const response = await fetch("/api/support/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to mark all as read.");
      }

      setNotifications((current) =>
        current.map((item) => ({ ...item, is_read: true }))
      );
      setUnreadCount(0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update notifications."
      );
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="relative z-30">
      <button
        type="button"
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) void loadNotifications(true);
        }}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={isOpen}
        className="relative inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        <span className="text-sm font-semibold">Notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -right-2 -top-2 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-10 cursor-default bg-transparent"
            onClick={() => setIsOpen(false)}
          />

          <section
            aria-label="Support notifications"
            className="absolute right-0 top-14 z-20 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="font-semibold">Notifications</h2>
                <p className="text-xs text-slate-500">
                  {unreadCount} unread
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadNotifications(true)}
                  disabled={loading}
                  className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void markAllAsRead()}
                  disabled={unreadCount === 0 || markingAll}
                  className="text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  {markingAll ? "Saving..." : "Mark all read"}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <div className="max-h-[28rem] overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Loading notifications...
                </p>
              ) : notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  You're all caught up. No notifications yet.
                </p>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleNotificationClick(notification)}
                    disabled={updatingId === notification.id}
                    className={`block w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 disabled:opacity-60 ${
                      notification.is_read ? "bg-white" : "bg-blue-50/70"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          notification.is_read ? "bg-slate-300" : "bg-blue-600"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">
                          {notification.title}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-slate-600">
                          {notification.message}
                        </span>
                        <span className="mt-2 block text-xs text-slate-400">
                          {formatNotificationDate(notification.created_at)}
                        </span>
                      </span>
                      {!notification.is_read && (
                        <span className="shrink-0 text-[11px] font-semibold text-blue-700">
                          New
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  router.push("/recruiter/support");
                }}
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                Open Support Management Centre →
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
