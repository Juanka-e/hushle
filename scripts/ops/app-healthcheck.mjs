try {
    const response = await fetch("http://127.0.0.1:3000/api/health", {
        headers: { "x-health-token": process.env.HEALTHCHECK_TOKEN || "" },
        signal: AbortSignal.timeout(8000),
    });
    const body = await response.json();
    if (!response.ok || body.status !== "ok" || body.dependencies?.database?.available === false || (body.dependencies?.redis?.configured && !body.dependencies.redis.available)) process.exitCode = 1;
} catch {
    process.exitCode = 1;
}
