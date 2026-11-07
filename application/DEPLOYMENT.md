<!-- markdownlint-disable -->

# 🚀 IPTV M3U Reader - Production Deployment Guide

## 📋 Pre-Deployment Checklist

### ✅ Code Quality Verification

```bash
# Run all quality checks
npm run typecheck     # TypeScript validation
npm run lint          # ESLint code quality
npm test              # Full test suite
npm run build         # Production build test
```

### ✅ Performance Optimization

```bash
# Analyze bundle size
npm run build
npx vite-bundle-analyzer dist

# Check for large dependencies
npx depcheck
npx npm-check-updates
```

### ✅ Security Audit

```bash
# Security vulnerability scan
npm audit
npm audit fix

# Check for outdated packages
npm outdated
```

## 🌐 Deployment Options

### Option 1: Static Site Hosting (Recommended)

#### Netlify Deployment
1. **Build Configuration** (`netlify.toml`):
```toml
[build]
  publish = "dist"
  command = "npm run build"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

2. **Deploy Steps**:
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build for production
npm run build

# Deploy to Netlify
netlify deploy --prod --dir=dist
```

#### Vercel Deployment
1. **Configuration** (`vercel.json`):
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

2. **Deploy Steps**:
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### GitHub Pages Deployment
1. **GitHub Actions** (`.github/workflows/deploy.yml`):
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run tests
      run: npm test
      
    - name: Build
      run: npm run build
      
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./dist
```

### Option 2: Docker Container

#### Dockerfile
```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Production image
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Nginx Configuration (`nginx.conf`)
```nginx
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    
    server {
        listen 80;
        server_name localhost;
        
        root /usr/share/nginx/html;
        index index.html;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        
        # Cache static assets
        location /assets/ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        
        # SPA routing
        location / {
            try_files $uri $uri/ /index.html;
        }
        
        # API proxy (if needed)
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

#### Docker Compose (`docker-compose.yml`)
```yaml
version: '3.8'

services:
  iptv-app:
    build: .
    ports:
      - "80:80"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    
  # Optional: Add a reverse proxy
  proxy:
    image: traefik:v2.10
    command:
      - --api.insecure=true
      - --providers.docker=true
      - --entrypoints.web.address=:80
    ports:
      - "80:80"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    labels:
      - "traefik.enable=false"
```

### Option 3: Cloud Platforms

#### AWS S3 + CloudFront
```bash
# Build the application
npm run build

# Upload to S3
aws s3 sync dist/ s3://your-bucket-name --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

#### Google Cloud Storage
```bash
# Build the application
npm run build

# Upload to GCS
gsutil -m rsync -r -d dist/ gs://your-bucket-name

# Set appropriate permissions
gsutil web set -m index.html -e index.html gs://your-bucket-name
```

## ⚙️ Environment Configuration

### Production Environment Variables
Create `.env.production`:
```env
VITE_APP_TITLE=IPTV M3U Reader
VITE_APP_VERSION=1.0.0
VITE_ENABLE_TELEMETRY=false
VITE_DEFAULT_PROXY_TIMEOUT=15000
VITE_API_BASE_URL=https://api.your-domain.com
```

### Build Optimization
Update `vite.config.ts` for production:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  
  build: {
    // Optimize chunks
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          charts: ['recharts'],
          router: ['react-router-dom'],
        },
      },
    },
    
    // Performance settings
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    
    // Bundle analysis
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
  },
  
  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

## 🔒 Security Considerations

### Content Security Policy
Add to your HTML or server configuration:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  media-src 'self' https: http:;
  connect-src 'self' https: http: ws: wss:;
  font-src 'self' data:;
">
```

### HTTPS Configuration
Ensure all deployments use HTTPS:
- Use Let's Encrypt for free SSL certificates
- Configure HSTS headers
- Implement secure cookie settings

### API Security
```typescript
// Add request timeout and retry logic
const fetchWithTimeout = async (url: string, options: RequestInit = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};
```

## 📊 Monitoring & Analytics

### Performance Monitoring
```typescript
// Add to main.tsx
if ('performance' in window && 'PerformanceObserver' in window) {
  // Monitor Core Web Vitals
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.log(`${entry.name}: ${entry.value}`);
      // Send to analytics service
    }
  });
  
  observer.observe({ entryTypes: ['measure', 'navigation'] });
}
```

### Error Tracking
```typescript
// Error boundary with reporting
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Send to error tracking service
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // Send to error tracking service
});
```

## 🚀 Performance Optimization

### Bundle Analysis
```bash
# Analyze bundle size
npm run build
npx vite-bundle-analyzer dist

# Check for duplicate dependencies
npx duplicate-package-checker-webpack-plugin
```

### CDN Configuration
```typescript
// Use CDN for heavy dependencies
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
});
```

### Service Worker (Optional)
```javascript
// public/sw.js
const CACHE_NAME = 'iptv-reader-v1';
const urlsToCache = [
  '/',
  '/static/css/main.css',
  '/static/js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
```

## 🔧 Troubleshooting

### Common Issues

#### Large Bundle Size
```bash
# Check bundle composition
npx webpack-bundle-analyzer dist

# Solutions:
# 1. Enable tree shaking
# 2. Split vendor chunks
# 3. Use dynamic imports
# 4. Remove unused dependencies
```

#### Memory Leaks
```typescript
// Add cleanup in components
useEffect(() => {
  const cleanup = () => {
    // Cleanup subscriptions, timers, etc.
  };
  
  return cleanup;
}, []);
```

#### Performance Issues
```typescript
// Use React.memo for expensive components
const ExpensiveComponent = React.memo(({ data }) => {
  // Component logic
});

// Use useMemo for expensive calculations
const expensiveValue = useMemo(() => {
  return heavyCalculation(data);
}, [data]);
```

### Debug Production Issues
```bash
# Enable source maps for debugging (temporary)
VITE_SOURCEMAP=true npm run build

# Check network requests
# Use browser dev tools Network tab

# Monitor console errors
# Use error tracking service
```

## 📝 Deployment Checklist

- [ ] All tests passing
- [ ] Build successful without warnings
- [ ] Security audit clean
- [ ] Environment variables configured
- [ ] HTTPS enabled
- [ ] CDN configured
- [ ] Error tracking enabled
- [ ] Performance monitoring active
- [ ] Backup strategy in place
- [ ] Rollback plan documented

## 📞 Support

For deployment issues:
1. Check the troubleshooting section
2. Verify environment configuration
3. Check server logs
4. Monitor performance metrics
5. Create issue with deployment details

---

**Last Updated**: September 2025  
**Version**: 1.0.0
