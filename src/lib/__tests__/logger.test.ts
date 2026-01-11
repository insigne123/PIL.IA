// Example test for logger utility
import { logger } from '../logger';

describe('Logger Utility', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('debug', () => {
        it('should log in development environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            logger.debug('test message');

            expect(consoleLogSpy).toHaveBeenCalledWith('[DEBUG]', 'test message');

            process.env.NODE_ENV = originalEnv;
        });

        it('should not log in production environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            logger.debug('test message');

            expect(consoleLogSpy).not.toHaveBeenCalled();

            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('error', () => {
        it('should always log errors', () => {
            logger.error('error message');

            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'error message');
        });
    });

    describe('warn', () => {
        it('should always log warnings', () => {
            logger.warn('warning message');

            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'warning message');
        });
    });
});
