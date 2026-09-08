import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WarehousesToggle from './WarehousesToggle';

const renderToggle = ({ values, ...props } = {}) =>
  render(
    <WarehousesToggle
      onChange={vi.fn()}
      productCount={50}
      {...props}
      values={{
        createWarehouses: true,
        reuseExistingWarehouses: true,
        warehouseCount: 5,
        ...values,
      }}
    />
  );

describe('WarehousesToggle', () => {
  it('offers the three strategies and not the incoherent fourth', () => {
    renderToggle();

    expect(screen.getByText('Top up to the total below')).toBeInTheDocument();
    expect(
      screen.getByText('Create a new set, leaving existing ones alone')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Use only the warehouses already there')
    ).toBeInTheDocument();
  });

  describe('the count label follows the strategy, because it counts different things', () => {
    it('is a total when topping up', () => {
      renderToggle();

      expect(
        screen.getByLabelText('Total Number of Warehouses')
      ).toBeInTheDocument();
    });

    it('is a number to create for a fresh set', () => {
      renderToggle({ values: { reuseExistingWarehouses: false } });

      expect(
        screen.getByLabelText('Number of Warehouses to Create')
      ).toBeInTheDocument();
    });

    it('is absent when no warehouses are being created', () => {
      renderToggle({ values: { createWarehouses: false } });

      expect(
        screen.queryByLabelText(/Number of Warehouses/)
      ).not.toBeInTheDocument();
    });
  });

  describe('spelling out what the count will do', () => {
    // The point of showing the instance's count: not "should I reuse?", which
    // needs a look at Liferay anyway, but "do I understand what this number
    // means?".
    it('says how many of a top-up will actually be created', () => {
      renderToggle({ existingWarehouseCount: 2 });

      expect(
        screen.getByText('2 already here, so 3 will be created to reach 5.')
      ).toBeInTheDocument();
    });

    it('says when a top-up will create nothing at all', () => {
      renderToggle({ existingWarehouseCount: 5 });

      expect(
        screen.getByText('5 already here, so none will be created.')
      ).toBeInTheDocument();
    });

    it('says the total a fresh set leaves behind, and what will not be stocked', () => {
      renderToggle({
        existingWarehouseCount: 2,
        values: { reuseExistingWarehouses: false },
      });

      expect(
        screen.getByText(
          '5 will be created, leaving 7 in total. The existing 2 will not receive inventory.'
        )
      ).toBeInTheDocument();
    });

    it('warns that using only existing warehouses has nowhere to put stock', () => {
      renderToggle({
        existingWarehouseCount: 0,
        values: { createWarehouses: false },
      });

      expect(
        screen.getByText(
          'This instance has no warehouses, so there would be nowhere to put inventory.'
        )
      ).toBeInTheDocument();
    });

    it('says nothing when the count was never read', () => {
      // An unknown count proves nothing, so it must not be reported as zero.
      renderToggle();

      expect(screen.queryByText(/already here/)).not.toBeInTheDocument();
    });
  });

  describe('ruling out an impossible choice', () => {
    it('disables using only existing warehouses when there are none', () => {
      renderToggle({ existingWarehouseCount: 0 });

      expect(
        screen.getByRole('option', {
          name: 'Use only the warehouses already there',
        })
      ).toBeDisabled();
    });

    it('leaves it enabled when the count is unknown, rather than guessing', () => {
      renderToggle();

      expect(
        screen.getByRole('option', {
          name: 'Use only the warehouses already there',
        })
      ).not.toBeDisabled();
    });

    it('leaves it enabled when warehouses exist', () => {
      renderToggle({ existingWarehouseCount: 3 });

      expect(
        screen.getByRole('option', {
          name: 'Use only the warehouses already there',
        })
      ).not.toBeDisabled();
    });
  });

  it('sets both booleans when the strategy changes, never a half state', () => {
    const onChange = vi.fn();

    renderToggle({ onChange });

    // Both flags must move together, or the pair can express the unsupported
    // "create nothing, adopt nothing" combination.
    const select = screen.getByLabelText('Warehouses');

    select.value = 'fresh-set';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('createWarehouses', true);
    expect(onChange).toHaveBeenCalledWith('reuseExistingWarehouses', false);
  });
});
