# 📺 IPTV M3U Reader - Comprehensive Documentation

## 🎯 Project Overview

The IPTV M3U Reader is a modern, feature-rich web application built with React 18, TypeScript, and Vite. It provides a comprehensive solution for managing and streaming IPTV content with advanced features like HLS streaming, connectivity diagnostics, telemetry monitoring, and more.

## 🚀 Key Features

### Core Functionality
- **M3U/M3U8 Playlist Support**: Full support for M3U and M3U8 playlist formats
- **HLS Streaming**: Native HLS.js integration with fallback support
- **Multi-Protocol Support**: HTTP, HTTPS, and direct stream compatibility
- **Advanced Error Handling**: Circuit breaker pattern with automatic fallback
- **Variant Management**: Automatic quality switching and manual variant selection

### User Experience
- **Modern UI**: Built with shadcn/ui components and Tailwind CSS
- **Dark/Light Theme**: Automatic system detection with manual override
- **Keyboard Navigation**: Full keyboard support for TV-style experience
- **Responsive Design**: Mobile-first approach with desktop optimization
- **Virtual Scrolling**: Efficient rendering for large channel lists

### Advanced Features
- **Connectivity Diagnostics**: Comprehensive network testing and troubleshooting
- **Performance Monitoring**: Real-time FPS, memory usage, and performance metrics
- **Telemetry System**: Detailed logging and analytics with privacy controls
- **Configuration Management**: Export/import settings with validation
- **Playlist Analysis**: Statistical analysis of channel distribution and quality

## 🏗️ Architecture

### Technology Stack
```
Frontend Framework:     React 18.3.1
Language:              TypeScript 5.5.3
Build Tool:            Vite 5.4.1
Styling:               Tailwind CSS 3.4.11
UI Components:         shadcn/ui (Radix UI)
State Management:      React Query v5
Routing:               React Router v6
Database:              IndexedDB (via idb)
Testing:               Vitest + Testing Library
```

### Project Structure
```
src/
├── components/           # React components
│   ├── ui/              # shadcn/ui components
│   ├── IPTVPlayer.tsx   # Main player component
│   ├── VideoPlayer.tsx  # Video streaming component
│   ├── ChannelList.tsx  # Channel management
│   ├── PlaylistLoader.tsx # Playlist loading and parsing
│   ├── ConnectivityTroubleshooter.tsx # Network diagnostics
│   ├── PerformanceMonitor.tsx # Performance metrics
│   └── PlaylistAnalyzer.tsx # Statistical analysis
├── hooks/               # Custom React hooks
│   ├── useVideoPlayer.ts # Video player logic
│   ├── useKeyboardNavigation.ts # Keyboard controls
│   └── useDebounce.ts   # Debounced state management
├── utils/               # Utility functions
│   ├── m3uParser.ts     # M3U playlist parsing
│   ├── corsProxy.ts     # CORS proxy handling
│   ├── storage.ts       # Settings and data persistence
│   ├── idb.ts          # IndexedDB operations
│   └── telemetry/       # Telemetry and logging
├── types/               # TypeScript type definitions
├── workers/             # Web Workers
└── test/               # Test suites
```

### Component Hierarchy
```
App
├── ErrorBoundary
├── IPTVPlayer (Main Container)
│   ├── PlaylistLoader
│   │   └── ConnectivityTroubleshooter
│   ├── ChannelList (Lazy Loaded)
│   ├── VideoPlayer (Lazy Loaded)
│   │   ├── PerformanceMonitor
│   │   └── TelemetryDisplay
│   ├── SettingsPanel (Lazy Loaded)
│   │   └── ConfigurationManager
│   └── PlaylistAnalyzer
└── NotFound (Route Fallback)
```

## 📋 API Reference

### Core Components

#### IPTVPlayer
Main container component that orchestrates the entire application.

```typescript
interface IPTVPlayerProps {
  // No props - self-contained
}
```

**Key Features:**
- Playlist management and persistence
- Channel selection and playback
- Settings integration
- Telemetry collection

#### VideoPlayer
Advanced video streaming component with HLS support.

```typescript
interface VideoPlayerProps {
  channel: Channel;
  className?: string;
  autoplay?: boolean;
}
```

**Features:**
- HLS.js integration with fallback
- Circuit breaker pattern for error handling
- Automatic variant switching
- Performance telemetry
- Full-screen support
- Keyboard controls

#### ChannelList
Virtualized channel list with advanced filtering.

```typescript
interface ChannelListProps {
  channels: Channel[];
  onChannelSelect: (channel: Channel) => void;
  currentChannel?: Channel;
  compactMode?: boolean;
  virtualizationEnabled?: boolean;
}
```

**Features:**
- Virtual scrolling for performance
- Search and filtering
- Group organization
- Favorites management
- Compact/detailed view modes

### Utility Classes

#### M3UParser
Robust M3U playlist parser with worker support.

```typescript
class M3UParser {
  static parseM3U(content: string, playlistName?: string): PlaylistInfo;
  static parseM3UWorker(content: string, playlistName?: string): Promise<PlaylistInfo>;
  static parseM3UAsync(content: string, playlistName?: string): Promise<PlaylistInfo>;
}
```

#### CORSProxy
Handles CORS and mixed content issues.

```typescript
class CORSProxy {
  static fetchWithProxy(url: string, options?: RequestInit): Promise<string>;
  static testConnectivity(url: string): Promise<boolean>;
  static convertToHttps(url: string): string;
  static isMixedContentIssue(url: string): boolean;
}
```

#### StorageManager
Manages application settings and data persistence.

```typescript
class StorageManager {
  static getSettings(): AppSettings;
  static loadSettingsAsync(): Promise<AppSettings>;
  static saveSettings(settings: AppSettings): void;
  static defaultSettings(): AppSettings;
}
```

### Hooks

#### useVideoPlayer
Core video player functionality.

```typescript
function useVideoPlayer(): {
  videoRef: RefObject<HTMLVideoElement>;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  isFullscreen: boolean;
  volume: number;
  retryAttempts: number;
  playStream: (url: string, options?: PlayOptions) => Promise<void>;
  togglePlay: () => void;
  toggleFullscreen: () => void;
  changeVolume: (volume: number) => void;
  manualRetry: () => void;
}
```

#### useKeyboardNavigation
TV-style keyboard navigation.

```typescript
function useKeyboardNavigation(
  channels: Channel[],
  onChannelSelect: (channel: Channel) => void,
  enabled?: boolean
): {
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}
```

## 🔧 Configuration

### Application Settings

```typescript
interface AppSettings {
  volume: number;                    // 0-1 volume level
  autoplay: boolean;                // Auto-start playback
  theme: 'light' | 'dark';          // UI theme
  keyboardNavigation: boolean;       // Enable keyboard controls
  compactModeDefault?: boolean;      // Default to compact view
  virtualizationEnabledDefault?: boolean; // Enable virtual scrolling
  telemetryPersistence?: boolean;    // Persist telemetry data
  muteOnStart?: boolean;            // Start muted
  playbackRate?: number;            // Playback speed (0.5-2.0)
  autoLoadLastPlaylist?: boolean;   // Auto-load last used playlist
  __version?: number;               // Settings version for migrations
}
```

### Environment Variables

```env
VITE_APP_TITLE=IPTV M3U Reader
VITE_APP_VERSION=1.0.0
VITE_ENABLE_TELEMETRY=true
VITE_DEFAULT_PROXY_TIMEOUT=15000
```

## 🧪 Testing

### Test Coverage
- **Unit Tests**: All utility functions and hooks
- **Component Tests**: UI components with user interactions
- **Integration Tests**: End-to-end workflows
- **Performance Tests**: Memory usage and render performance

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run with UI
npm run test:ui

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Test Structure
```
test/
├── m3uParser.test.ts              # Parser functionality
├── settingsPanelDiagnostics.test.tsx # Settings UI
├── performanceMonitor.test.tsx     # Performance monitoring
├── storageCacheStats.test.ts      # Storage system
├── telemetryLogger.test.ts        # Logging system
└── setup.ts                       # Test configuration
```

## 🚀 Build & Deployment

### Development
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
```

### Production Build
The application builds to a static site with optimized chunks:

```
dist/
├── index.html                     # Entry point
├── assets/
│   ├── index-[hash].css          # Styles (~68KB)
│   ├── index-[hash].js           # Main application (~71KB)
│   ├── vendor-react-[hash].js    # React dependencies (~713KB)
│   ├── channel-list-[hash].js    # Channel list (~130KB)
│   ├── video-player-[hash].js    # Video player (~30KB)
│   └── [other chunks]
└── [static assets]
```

### Performance Optimizations
- **Code Splitting**: Lazy loading for heavy components
- **Tree Shaking**: Unused code elimination
- **Bundle Analysis**: Chunk size optimization
- **Asset Optimization**: Image and font optimization

## 🔧 Advanced Features

### Connectivity Diagnostics
Comprehensive network testing including:
- Internet connectivity validation
- DNS resolution testing
- CORS policy verification
- Protocol compatibility checks
- Geolocation-based restrictions
- Proxy service testing

### Performance Monitoring
Real-time performance metrics:
- Frame rate (FPS) monitoring
- Memory usage tracking
- Component mount/render counting
- Performance status indicators
- Optimization recommendations

### Telemetry System
Privacy-focused analytics:
- Stream startup latency
- Error tracking and categorization
- User interaction patterns
- Performance bottleneck identification
- Configurable data retention

### Circuit Breaker Pattern
Fault tolerance for streaming:
- Automatic failure detection
- Cooldown periods
- Variant switching
- Retry strategies
- User feedback

## 🔐 Security

### Content Security Policy
Configured for secure operation while allowing necessary external resources.

### Data Privacy
- No external analytics by default
- Local storage of user preferences
- Optional telemetry with user control
- No personal data collection

### CORS Handling
Multiple proxy services for cross-origin requests with graceful fallbacks.

## 📈 Performance

### Optimization Strategies
1. **Virtual Scrolling**: Efficient rendering of large channel lists
2. **Lazy Loading**: Components loaded on demand
3. **Memoization**: React.memo and useMemo for expensive calculations
4. **Web Workers**: Background M3U parsing
5. **IndexedDB**: Efficient local data storage

### Performance Metrics
- **Initial Load**: < 3 seconds on 3G
- **Time to Interactive**: < 5 seconds
- **Memory Usage**: < 100MB typical
- **Bundle Size**: < 1MB main bundle

## 🐛 Troubleshooting

### Common Issues

#### Playlist Loading Fails
1. Check network connectivity
2. Verify URL format and accessibility
3. Try HTTPS version if available
4. Use connectivity troubleshooter
5. Check for geo-blocking

#### Video Playback Issues
1. Verify stream URL validity
2. Check browser HLS support
3. Try different quality variants
4. Clear browser cache
5. Check console for errors

#### Performance Issues
1. Enable performance monitor
2. Check memory usage
3. Reduce channel list size
4. Enable virtualization
5. Close other browser tabs

### Debug Mode
Enable detailed logging:
```javascript
localStorage.setItem('debug', 'iptv:*');
```

## 🤝 Contributing

### Development Setup
1. Clone repository
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
4. Run tests: `npm test`

### Code Standards
- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting
- Conventional commits
- Test coverage > 80%

### Pull Request Process
1. Create feature branch
2. Implement changes with tests
3. Update documentation
4. Submit PR with detailed description
5. Address review feedback

## 📄 License

MIT License - See LICENSE file for details.

## 🆘 Support

For issues and support:
1. Check troubleshooting guide
2. Use connectivity diagnostics
3. Enable debug logging
4. Create GitHub issue with logs
5. Include system information

---

**Version**: 1.0.0  
**Last Updated**: September 2025  
**Compatibility**: Modern browsers with ES2020+ support
