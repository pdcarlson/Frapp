import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders correctly with default props', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-primary text-primary-foreground hover:bg-primary/90');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders correctly with secondary variant', () => {
    render(<Button variant="secondary">Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('border border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground');
  });

  it('renders correctly with ghost variant', () => {
    render(<Button variant="ghost">Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('text-foreground hover:bg-accent hover:text-accent-foreground');
  });

  it('applies custom className', () => {
    render(<Button className="custom-class">Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('custom-class');
    expect(button).toHaveClass('bg-primary text-primary-foreground hover:bg-primary/90');
  });

  it('passes through other HTML button attributes', () => {
    render(<Button disabled aria-label="custom-label" data-testid="test-btn">Click me</Button>);
    const button = screen.getByTestId('test-btn');
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-label', 'custom-label');
  });

  it('allows overriding the type attribute', () => {
    render(<Button type="submit">Submit</Button>);
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toHaveAttribute('type', 'submit');
  });
});
