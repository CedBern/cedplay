import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualitySelector } from '@/components/QualitySelector';
import { ConnectionQuality } from '@/components/ConnectionQuality';
import type { NetworkStatus } from '@/hooks/useNetworkStatus';

// Mock network status for testing
const mockNetworkStatus: NetworkStatus = {
  isOnline: true,
  connectionType: 'wifi',
  effectiveType: '4g',
  downlink: 10.5,
  rtt: 45
};

describe('Enhanced Video Player Components', () => {
  describe('QualitySelector', () => {
    const mockOnQualityChange = vi.fn();
    
    beforeEach(() => {
      mockOnQualityChange.mockClear();
    });

    it('renders quality selector with available qualities', () => {
      const qualities = ['auto', '1080p', '720p', '480p'];
      
      render(
        <QualitySelector
          currentQuality="auto"
          availableQualities={qualities}
          onQualityChange={mockOnQualityChange}
        />
      );

      expect(screen.getByText('Auto')).toBeInTheDocument();
    });

    it('calls onQualityChange when quality is selected', async () => {
      const qualities = ['auto', '1080p', '720p', '480p'];
      
      render(
        <QualitySelector
          currentQuality="auto"
          availableQualities={qualities}
          onQualityChange={mockOnQualityChange}
        />
      );

      // Open dropdown
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Auto/ }));
      
      // Wait for dropdown to appear and click on 1080p
      await user.click(await screen.findByText('1080p'));

      expect(mockOnQualityChange).toHaveBeenCalledWith(1);
    });

    it('does not render when only one quality available', () => {
      const qualities = ['auto'];
      
      const { container } = render(
        <QualitySelector
          currentQuality="auto"
          availableQualities={qualities}
          onQualityChange={mockOnQualityChange}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('disables selector when disabled prop is true', () => {
      const qualities = ['auto', '1080p', '720p'];
      
      render(
        <QualitySelector
          currentQuality="auto"
          availableQualities={qualities}
          onQualityChange={mockOnQualityChange}
          disabled={true}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });
  });

  describe('ConnectionQuality', () => {
    it('renders excellent connection status', () => {
      const excellentNetwork = {
        ...mockNetworkStatus,
        effectiveType: '4g' as const,
        downlink: 15
      };

      render(<ConnectionQuality networkStatus={excellentNetwork} />);

      expect(screen.getByText('Excellente connexion')).toBeInTheDocument();
      expect(screen.getByText(/Type: 4G.*Débit: 15.0 Mbps/)).toBeInTheDocument();
    });

    it('renders poor connection status', () => {
      const poorNetwork = {
        ...mockNetworkStatus,
        effectiveType: '2g' as const,
        downlink: 0.5
      };

      render(<ConnectionQuality networkStatus={poorNetwork} />);

      expect(screen.getByText('Connexion faible')).toBeInTheDocument();
    });

    it('renders offline status', () => {
      const offlineNetwork = {
        ...mockNetworkStatus,
        isOnline: false
      };

      render(<ConnectionQuality networkStatus={offlineNetwork} />);

      expect(screen.getByText('Hors ligne')).toBeInTheDocument();
      expect(screen.getByText('Aucune connexion internet')).toBeInTheDocument();
    });
  });

});
