/**
 * Two products of the kind the UAT run produced, in Liferay's DTO shape.
 *
 * One carries a SKU-contributing option and so exists in Liferay as variants
 * with no base SKU; the other is a plain product with one SKU. Between them
 * they cover both halves of the branch `translateProduct` has to get right,
 * and both halves of the branch `products.cjs` and `skus.cjs` take on the way
 * back in.
 *
 * The codes are AICA's own, so the default ownership scope claims them - the
 * round-trip case #849 names as the default (#850).
 */

const HELMET = {
  attachments: [
    {
      contentType: 'application/pdf',
      externalReferenceCode: 'ATT-HELMET-MANUAL',
      id: 90201,
      priority: 1,
      src: '/o/commerce-media/attachments/90201',
      title: { en_US: 'Alpine Helmet manual' },
    },
  ],
  images: [
    {
      contentType: 'image/webp',
      externalReferenceCode: 'IMG-HELMET-1',
      id: 90101,
      priority: 1,
      src: '/o/commerce-media/images/90101',
      title: { en_US: 'Alpine Helmet' },
    },
  ],
  options: [
    {
      fieldType: 'select',
      id: 71565,
      key: 'shell-size',
      name: { en_US: 'Shell Size' },
      optionId: 71501,
      productOptionValues: [
        { id: 71566, key: 'm', name: { en_US: 'M' } },
        { id: 71567, key: 'l', name: { en_US: 'L' } },
      ],
      required: true,
      skuContributor: true,
    },
  ],
  product: {
    active: true,
    catalogId: 61432,
    categories: [
      {
        externalReferenceCode: 'CAT-RIDER-GEAR',
        id: 70910,
        name: 'Rider Gear',
        title: { en_US: 'Rider Gear' },
        vocabulary: 'Category',
      },
    ],
    description: {
      en_US: 'A fibreglass touring helmet with a drop-down sun visor.',
    },
    externalReferenceCode: 'AICA-PRD-HELMET',
    id: 71550,
    metaDescription: { en_US: 'Touring helmet' },
    metaKeyword: { en_US: 'helmet,touring' },
    metaTitle: { en_US: 'Alpine Helmet' },
    name: { en_US: 'Alpine Helmet' },
    productConfiguration: { allowBackOrder: true },
    productId: 71551,
    productType: 'simple',
    shortDescription: { en_US: 'Fibreglass touring helmet.' },
    urls: { en_US: 'alpine-helmet' },
  },
  skus: [
    {
      cost: 120,
      externalReferenceCode: 'AICA-HELMET-M',
      id: 71569,
      inventoryLevel: 24,
      price: 240,
      productId: 71551,
      published: true,
      purchasable: true,
      sku: 'AICA-HELMET-M',
      skuOptions: [
        {
          key: 'shell-size',
          optionId: 71565,
          optionValueId: 71566,
          value: 'M',
        },
      ],
    },
    {
      cost: 132,
      externalReferenceCode: 'AICA-HELMET-L',
      id: 71570,
      inventoryLevel: 0,
      price: 264,
      productId: 71551,
      published: true,
      purchasable: true,
      sku: 'AICA-HELMET-L',
      skuOptions: [
        {
          key: 'shell-size',
          optionId: 71565,
          optionValueId: 71567,
          value: 'L',
        },
      ],
    },
  ],
  specifications: [
    {
      externalReferenceCode: 'PS-71600',
      id: 71600,
      label: { en_US: 'Shell material' },
      productId: 71551,
      specificationExternalReferenceCode: 'SPEC-SHELL-MATERIAL',
      specificationId: 71512,
      specificationKey: 'shell-material',
      value: { en_US: 'Fibreglass composite' },
    },
  ],
};

const PANNIER = {
  attachments: [],
  images: [
    {
      contentType: 'image/webp',
      externalReferenceCode: 'IMG-PANNIER-1',
      id: 90102,
      priority: 1,
      src: '/o/commerce-media/images/90102',
      title: { en_US: 'Pannier Liner' },
    },
  ],
  options: [],
  product: {
    active: true,
    catalogId: 61432,
    categories: [
      {
        externalReferenceCode: 'CAT-LUGGAGE',
        id: 70911,
        name: 'Luggage',
        title: { en_US: 'Luggage' },
        vocabulary: 'Category',
      },
    ],
    description: { en_US: 'A waterproof roll-top liner for hard panniers.' },
    externalReferenceCode: 'AICA-PRD-PANNIER',
    id: 71580,
    metaDescription: { en_US: 'Waterproof pannier liner' },
    metaKeyword: { en_US: 'pannier,liner,waterproof' },
    metaTitle: { en_US: 'Pannier Liner' },
    name: { en_US: 'Pannier Liner' },
    productConfiguration: { allowBackOrder: false },
    productId: 71581,
    productType: 'simple',
    shortDescription: { en_US: 'Waterproof roll-top liner.' },
    urls: { en_US: 'pannier-liner' },
  },
  skus: [
    {
      cost: 18,
      externalReferenceCode: 'AICA-PANNIER-STD',
      id: 71582,
      inventoryLevel: 60,
      price: 45,
      productId: 71581,
      published: true,
      purchasable: true,
      sku: 'AICA-PANNIER-STD',
      skuOptions: [],
    },
  ],
  specifications: [
    {
      externalReferenceCode: 'PS-71601',
      id: 71601,
      label: { en_US: 'Capacity' },
      productId: 71581,
      specificationExternalReferenceCode: 'SPEC-CAPACITY',
      specificationId: 71513,
      specificationKey: 'capacity',
      value: { en_US: '30 litres' },
    },
  ],
};

/** One entry per SKU in the base list, and a promotion on one of them. */
const PRICE_LISTS = [
  {
    catalogId: 61432,
    externalReferenceCode: 'PL-GENERAL',
    id: 30001,
    name: 'Solara Moto Base Price List',
    type: 'price-list',
    entries: [
      {
        externalReferenceCode: 'PE-HELMET-M',
        id: 40001,
        price: 240,
        skuExternalReferenceCode: 'AICA-HELMET-M',
        tierPrices: [
          {
            externalReferenceCode: 'TP-HELMET-M-10',
            minimumQuantity: 10,
            price: 216,
          },
        ],
      },
      {
        externalReferenceCode: 'PE-HELMET-L',
        id: 40002,
        price: 264,
        skuExternalReferenceCode: 'AICA-HELMET-L',
        tierPrices: [],
      },
      {
        externalReferenceCode: 'PE-PANNIER',
        id: 40003,
        price: 45,
        skuExternalReferenceCode: 'AICA-PANNIER-STD',
        tierPrices: [],
      },
    ],
  },
  {
    catalogId: 61432,
    externalReferenceCode: 'PL-PROMO',
    id: 30002,
    name: 'Solara Moto Base Promotion',
    type: 'promotion',
    entries: [
      {
        externalReferenceCode: 'PE-HELMET-M-PROMO',
        id: 40004,
        price: 199,
        skuExternalReferenceCode: 'AICA-HELMET-M',
      },
    ],
  },
];

const WAREHOUSES = [
  {
    active: true,
    city: 'London',
    countryISOCode: 'GB',
    description: { en_US: 'Southern distribution' },
    externalReferenceCode: 'AICA-WH-LONDON',
    id: 71491,
    latitude: 51.5072,
    longitude: -0.1276,
    name: { en_US: 'London' },
    regionISOCode: 'LND',
    street1: '1 Bankside',
    zip: 'SE1 9AA',
  },
  {
    active: true,
    city: 'Rotterdam',
    countryISOCode: 'NL',
    externalReferenceCode: 'CUSTOMER-WH-ROTTERDAM',
    id: 71492,
    latitude: 51.9244,
    longitude: 4.4777,
    name: { en_US: 'Rotterdam' },
    street1: 'Wilhelminakade 1',
    zip: '3072 AP',
  },
];

module.exports = { HELMET, PANNIER, PRICE_LISTS, WAREHOUSES };
