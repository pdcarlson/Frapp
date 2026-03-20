# Notification Service Tests Specification

## Overview
This document outlines the test cases for the \`NotificationService\` to ensure all notification-related functionalities, including user notifications, chapter announcements, push tokens, preferences, and settings management work as expected.

## Scenarios Covered

- **notifyUser**:
  - Should skip delivery when preference is disabled for category.
  - Should deliver when preference is enabled.
  - Should downgrade NORMAL priority to SILENT during quiet hours.
  - Should NOT downgrade URGENT priority during quiet hours.
  - Should not send push when user has no push tokens.

- **notifyChapter**:
  - Should notify all chapter members successfully.

- **Push Token Management**:
  - Should register new push token.
  - Should return existing token when same user re-registers.
  - Should remove push token successfully.
  - Should throw \`NotFoundException\` when removing token not owned by user.

- **Mark Notification Read**:
  - Should mark notification as read successfully.
  - Should throw \`NotFoundException\` when notification not found.
  - Should throw \`NotFoundException\` when notification belongs to another user.

- **Preferences**:
  - Should get preferences for user and chapter.
  - Should update preference correctly.

- **Settings**:
  - Should get user settings.
  - Should return null when no settings exist.
  - Should update user settings.

- **listNotifications**:
  - Should list notifications for user when options (like \`limit\`) are provided.
  - Should list notifications for user without the \`limit\` option to verify default parameters handling.
