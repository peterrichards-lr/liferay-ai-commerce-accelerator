/**
 * Setting the catalog base flag on a price list, and saying so when it does not
 * take.
 *
 * `PATCH /price-lists/{id}` answers **200 and discards
 * `catalogBasePriceList`** on 2026.q3.0. Not a parsing failure: the same
 * request carrying `name` applies the name and drops the flag. `PUT` is 405,
 * `POST` with the flag is a 500, and `catalogBasePriceListId` is not a property
 * of `Catalog` at all - so there is no route to this field through Headless.
 * Filed as #943.
 *
 * Every caller that wrote the flag read that 200 as success, on the delete side
 * (#790) and on the generate side (#724) alike. Reading the value back is the
 * whole fix available to us until #943 moves upstream - it cannot make the
 * write land, but it stops the log claiming it did.
 *
 * @returns {Promise<boolean>} Whether the flag actually holds the wanted value.
 */
async function setCatalogBaseFlag(
  { liferay, logger },
  { catalogId, config, desired, priceListId, sessionId, what }
) {
  try {
    await liferay.patchPriceList(config, priceListId, {
      catalogBasePriceList: desired,
    });
  } catch (err) {
    logger.warn(
      `Failed to ${desired ? 'set' : 'unset'} catalogBasePriceList on ${what} ${priceListId}: ${err.message}`,
      { sessionId }
    );
    return false;
  }

  // The read-back. A 200 above means the request was accepted, not that the
  // field changed.
  try {
    const res = await liferay.getPriceLists(config, {
      catalogId,
      pageSize: 1000,
      ignoreExclusions: true,
    });
    const current = (res.items || []).find(
      (pl) => String(pl.id) === String(priceListId)
    );

    if (!current) {
      logger.warn(
        `Could not read ${what} ${priceListId} back after writing catalogBasePriceList, so whether it took is unknown`,
        { sessionId }
      );
      return false;
    }

    if (Boolean(current.catalogBasePriceList) === Boolean(desired)) {
      return true;
    }

    logger.warn(
      `Liferay accepted the request and did not change it: ${what} ${priceListId} still reports ` +
        `catalogBasePriceList=${Boolean(current.catalogBasePriceList)} after asking for ${Boolean(desired)}. ` +
        `The field cannot be set through Headless on this DXP line - see #943. ` +
        `The catalog's base list is whatever it was before this run.`,
      { sessionId }
    );
    return false;
  } catch (err) {
    logger.warn(
      `Could not verify catalogBasePriceList on ${what} ${priceListId}: ${err.message}`,
      { sessionId }
    );
    return false;
  }
}

module.exports = { setCatalogBaseFlag };
