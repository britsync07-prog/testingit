module.exports = {
    apps: [
        {
            name: 'leadhunter-production',
            script: 'src/server.js',
            instances: 'max', // Scale across all CPU cores
            exec_mode: 'cluster',
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: 3000,
                LOG_LEVEL: 'info'
            }
        }
    ]
};
