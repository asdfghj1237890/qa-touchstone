// Performance monitoring utility for the desktop application

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.isEnabled = process.env.NODE_ENV === 'development';
  }

  // Start timing an operation
  startTiming(operationName) {
    if (!this.isEnabled) return;
    
    const startTime = performance.now();
    this.metrics.set(operationName, {
      startTime,
      type: 'timing'
    });
  }

  // End timing an operation and log the result
  endTiming(operationName) {
    if (!this.isEnabled) return;
    
    const metric = this.metrics.get(operationName);
    if (!metric) {
      console.warn(`Performance: No start time found for ${operationName}`);
      return;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;
    
    console.log(`Performance: ${operationName} took ${duration.toFixed(2)}ms`);
    
    // Update metric with duration
    this.metrics.set(operationName, {
      ...metric,
      endTime,
      duration
    });

    return duration;
  }

  // Measure a function execution time
  measureAsync(operationName, asyncFunction) {
    if (!this.isEnabled) {
      return asyncFunction();
    }

    return new Promise((resolve, reject) => {
      this.startTiming(operationName);
      
      Promise.resolve(asyncFunction())
        .then(result => {
          this.endTiming(operationName);
          resolve(result);
        })
        .catch(error => {
          this.endTiming(operationName);
          reject(error);
        });
    });
  }

  // Measure synchronous function execution
  measureSync(operationName, syncFunction) {
    if (!this.isEnabled) {
      return syncFunction();
    }

    this.startTiming(operationName);
    try {
      const result = syncFunction();
      this.endTiming(operationName);
      return result;
    } catch (error) {
      this.endTiming(operationName);
      throw error;
    }
  }

  // Mark a specific point in time
  mark(markName) {
    if (!this.isEnabled) return;
    
    const timestamp = performance.now();
    this.metrics.set(markName, {
      timestamp,
      type: 'mark'
    });
    
    console.log(`Performance Mark: ${markName} at ${timestamp.toFixed(2)}ms`);
  }

  // Measure time between two marks
  measureBetweenMarks(startMark, endMark, measureName) {
    if (!this.isEnabled) return;
    
    const startMetric = this.metrics.get(startMark);
    const endMetric = this.metrics.get(endMark);
    
    if (!startMetric || !endMetric) {
      console.warn(`Performance: Missing marks for measurement ${measureName}`);
      return;
    }

    const duration = endMetric.timestamp - startMetric.timestamp;
    console.log(`Performance: ${measureName} took ${duration.toFixed(2)}ms`);
    
    this.metrics.set(measureName, {
      duration,
      type: 'measurement',
      startMark,
      endMark
    });

    return duration;
  }

  // Get all metrics
  getAllMetrics() {
    return Object.fromEntries(this.metrics);
  }

  // Clear all metrics
  clearMetrics() {
    this.metrics.clear();
  }

  // Log a performance summary
  logSummary() {
    if (!this.isEnabled) return;
    
    const timings = Array.from(this.metrics.entries())
      .filter(([, metric]) => metric.type === 'timing' && metric.duration !== undefined)
      .sort(([, a], [, b]) => b.duration - a.duration);

    if (timings.length === 0) {
      console.log('Performance: No timing data available');
      return;
    }

    console.group('Performance Summary');
    timings.forEach(([name, metric]) => {
      const color = metric.duration > 500 ? 'color: red' : 
                    metric.duration > 100 ? 'color: orange' : 
                    'color: green';
      console.log(`%c${name}: ${metric.duration.toFixed(2)}ms`, color);
    });
    console.groupEnd();
  }

  // Monitor component render times
  wrapComponent(Component, componentName) {
    if (!this.isEnabled) return Component;

    return function PerformanceWrappedComponent(props) {
      const renderStart = performance.now();
      
      // Use useEffect to measure actual render time
      React.useEffect(() => {
        const renderEnd = performance.now();
        const renderTime = renderEnd - renderStart;
        
        if (renderTime > 16) { // Only log if render takes longer than 16ms (60fps threshold)
          console.log(`Performance: ${componentName} render took ${renderTime.toFixed(2)}ms`);
        }
      });

      return React.createElement(Component, props);
    };
  }

  // Monitor memory usage
  logMemoryUsage(label = 'Memory Usage') {
    if (!this.isEnabled || !performance.memory) return;
    
    const memory = performance.memory;
    console.log(`${label}:`, {
      used: `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      total: `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      limit: `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`
    });
  }
}

// Create a singleton instance
const performanceMonitor = new PerformanceMonitor();

// React hook for performance monitoring
export const usePerformanceMonitor = () => {
  return {
    startTiming: performanceMonitor.startTiming.bind(performanceMonitor),
    endTiming: performanceMonitor.endTiming.bind(performanceMonitor),
    measureAsync: performanceMonitor.measureAsync.bind(performanceMonitor),
    measureSync: performanceMonitor.measureSync.bind(performanceMonitor),
    mark: performanceMonitor.mark.bind(performanceMonitor),
    measureBetweenMarks: performanceMonitor.measureBetweenMarks.bind(performanceMonitor),
    logMemoryUsage: performanceMonitor.logMemoryUsage.bind(performanceMonitor)
  };
};

// Higher-order component for performance monitoring
export const withPerformanceMonitoring = (Component, componentName) => {
  return performanceMonitor.wrapComponent(Component, componentName);
};

export default performanceMonitor;
