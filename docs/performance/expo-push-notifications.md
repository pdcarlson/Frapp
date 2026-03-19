# Expo Push Notifications Performance

We use Expo Server SDK to send push notifications to our users. Since Expo imposes a chunking limit on the number of messages that can be sent in a single network request, large notification broadcasts are split into smaller chunks.

To prevent N+1 network call delays (where each chunk waits for the previous one to finish sending over the network), we process these chunks concurrently using `Promise.allSettled`. This significantly reduces the total execution time for large notification broadcasts while ensuring isolated error handling per chunk.
