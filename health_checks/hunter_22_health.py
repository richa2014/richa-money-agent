#!/usr/bin/env python3
"""
Health check for hunter-22 service (hardening §7).
Monitors service availability and responds to regression alerts.
"""

import requests
import json
import time
from datetime import datetime
from typing import Dict, Any, Optional

class Hunter22HealthMonitor:
    """Health monitoring for hunter-22 service with regression detection."""
    
    def __init__(self, endpoint: str = "http://localhost:8080", timeout: int = 5):
        self.endpoint = endpoint
        self.timeout = timeout
        self.last_status: Optional[Dict[str, Any]] = None
        self.regression_threshold = 3  # Consecutive failures to trigger alert
        
    def check_health(self) -> Dict[str, Any]:
        """Perform health check and return status."""
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        try:
            response = requests.get(
                f"{self.endpoint}/health",
                timeout=self.timeout,
                headers={"Accept": "application/json"}
            )
            
            status_data = {
                "timestamp": timestamp,
                "status": "healthy" if response.status_code == 200 else "unhealthy",
                "http_status": response.status_code,
                "response_time_ms": response.elapsed.total_seconds() * 1000,
                "endpoint": self.endpoint,
                "regression_detected": False
            }
            
            # Check for regression pattern
            if self.last_status and self.last_status.get("status") == "healthy" and status_data["status"] == "unhealthy":
                status_data["regression_detected"] = True
                status_data["regression_alert"] = "Service transitioned from healthy to unhealthy"
                
            self.last_status = status_data
            return status_data
            
        except requests.exceptions.RequestException as e:
            status_data = {
                "timestamp": timestamp,
                "status": "unhealthy",
                "error": str(e),
                "endpoint": self.endpoint,
                "regression_detected": False
            }
            
            # Check for consecutive failures
            if (self.last_status and 
                self.last_status.get("status") == "unhealthy" and
                self.last_status.get("consecutive_failures", 0) >= self.regression_threshold - 1):
                status_data["regression_detected"] = True
                status_data["regression_alert"] = f"Service unavailable for {self.regression_threshold}+ consecutive checks"
                
            status_data["consecutive_failures"] = self.last_status.get("consecutive_failures", 0) + 1 if self.last_status else 1
            self.last_status = status_data
            return status_data
    
    def get_health_report(self) -> Dict[str, Any]:
        """Generate comprehensive health report."""
        current = self.check_health()
        
        return {
            "service": "hunter-22",
            "hardening_section": "§7",
            "current_status": current,
            "monitoring_timestamp": datetime.utcnow().isoformat() + "Z",
            "regression_monitoring": {
                "enabled": True,
                "threshold": self.regression_threshold,
                "alert_triggered": current.get("regression_detected", False)
            }
        }

def main():
    """Main health check execution."""
    monitor = Hunter22HealthMonitor()
    report = monitor.get_health_report()
    
    # Output structured health data
    print(json.dumps(report, indent=2))
    
    # Return appropriate exit code
    exit(0 if report["current_status"]["status"] == "healthy" else 1)

if __name__ == "__main__":
    main()
