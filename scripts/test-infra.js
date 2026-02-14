const { execSync } = require('child_process');

function runCommand(command) {
  try {
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

console.log('Verifying Infrastructure...');

// Verify Postgres
const postgresReady = runCommand('docker exec frapp_postgres pg_isready -U postgres -d frapp');
if (postgresReady) {
  console.log('✅ PostgreSQL is ready.');
} else {
  console.error('❌ PostgreSQL is NOT ready.');
  process.exit(1);
}

// Verify Redis
const redisReady = runCommand('docker exec frapp_redis redis-cli ping');
if (redisReady) {
  console.log('✅ Redis is ready.');
} else {
  console.error('❌ Redis is NOT ready.');
  process.exit(1);
}

// Verify MinIO
// MinIO health check returns 200 OK but body might be empty, so curl should succeed.
const minioReady = runCommand('docker exec frapp_minio curl -f http://localhost:9000/minio/health/live');
if (minioReady) {
  console.log('✅ MinIO is ready.');
} else {
  console.error('❌ MinIO is NOT ready.');
  process.exit(1);
}

console.log('🎉 All infrastructure services are ready!');
