-- Cleanup orphaned users without projects
-- Users that exist but have no project assignment

-- Check which users have no project assigned
SELECT 
    u.id,
    u.email,
    u.created_at,
    u.updated_at
FROM auth.users u
WHERE u.project_id IS NULL
ORDER BY u.created_at DESC;

-- Option 1: Delete old orphaned users (older than 30 days)
-- Uncomment to execute:
-- DELETE FROM auth.users 
-- WHERE project_id IS NULL 
--   AND created_at < NOW() - INTERVAL '30 days';

-- Option 2: Delete all orphaned users
-- Uncomment to execute:
-- DELETE FROM auth.users WHERE project_id IS NULL;

-- Show count of users that would be affected
SELECT COUNT(*) as orphaned_users_count 
FROM auth.users 
WHERE project_id IS NULL;