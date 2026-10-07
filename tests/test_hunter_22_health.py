#!/usr/bin/env python3
"""
Tests for hunter-22 health monitoring.
"""

import unittest
from unittest.mock import patch, Mock
import json
from health_checks.hunter_22_health import Hunter22HealthMonitor

class TestHunter22HealthMonitor(unittest.TestCase):
    
    def setUp(self):
        self.monitor = Hunter22HealthMonitor(endpoint="http://test-endpoint")
        
    @patch('requests.get')
    def test_healthy_response(self, mock_get):
        """Test healthy service response."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.elapsed.total_seconds.return_value = 0.1
        mock_get.return_value = mock_response
        
        result = self.monitor.check_health()
        
        self.assertEqual(result["status"], "healthy")
        self.assertFalse(result["regression_detected"])
        
    @patch('requests.get')
    def test_unhealthy_response(self, mock_get):
        """Test unhealthy service response."""
        mock_response = Mock()
        mock_response.status_code = 503
        mock_response.elapsed.total_seconds.return_value = 0.2
        mock_get.return_value = mock_response
        
        # First check - should be unhealthy but no regression
        result = self.monitor.check_health()
        self.assertEqual(result["status"], "unhealthy")
        self.assertFalse(result["regression_detected"])
        
        # Second consecutive unhealthy check - should detect regression
        result = self.monitor.check_health()
        self.assertEqual(result["status"], "unhealthy")
        self.assertTrue(result["regression_detected"])
        
    @patch('requests.get')
    def test_connection_error(self, mock_get):
        """Test connection error handling."""
        import requests
        mock_get.side_effect = requests.exceptions.ConnectionError("Connection failed")
        
        result = self.monitor.check_health()
        
        self.assertEqual(result["status"], "unhealthy")
        self.assertIn("error", result)
        
    def test_health_report_structure(self):
        """Test health report contains required fields."""
        with patch('requests.get') as mock_get:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.elapsed.total_seconds.return_value = 0.1
            mock_get.return_value = mock_response
            
            report = self.monitor.get_health_report()
            
            self.assertIn("service", report)
            self.assertEqual(report["service"], "hunter-22")
            self.assertIn("hardening_section", report)
            self.assertEqual(report["hardening_section"], "§7")
            self.assertIn("current_status", report)
            self.assertIn("regression_monitoring", report)

if __name__ == "__main__":
    unittest.main()
