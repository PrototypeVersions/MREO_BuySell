/*
  MREO PROPERTY DATA API
  Cloudflare Worker

  Purpose:
  - Receives a property address from the MREO GitHub Pages website
  - Keeps the RentCast API key private
  - Retrieves real property information
  - Retrieves current/last-known sale-listing information
  - Returns a clean JSON object to app.js

  Required Cloudflare secret:
    RENTCAST_API_KEY

  Recommended Cloudflare environment variable:
    ALLOWED_ORIGIN

  Example ALLOWED_ORIGIN:
    https://yourusername.github.io
*/

const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    /*
      Handle browser CORS preflight requests.
    */

    if (request.method === "OPTIONS") {
      return handleOptionsRequest(request, env);
    }

    /*
      This API is intentionally read-only.
    */

    if (request.method !== "GET") {
      return jsonResponse(
        {
          ok: false,
          error: "Method not allowed."
        },
        405,
        request,
        env
      );
    }

    /*
      Restrict calls to the MREO website when ALLOWED_ORIGIN
      has been configured.
    */

    if (
      env.ALLOWED_ORIGIN &&
      origin &&
      origin !== env.ALLOWED_ORIGIN
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "Origin not allowed."
        },
        403,
        request,
        env
      );
    }

    /*
      Confirm the RentCast key exists.
    */

    if (!env.RENTCAST_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          error:
            "The property-data service has not been configured."
        },
        500,
        request,
        env
      );
    }

    const requestUrl = new URL(request.url);

    const address =
      requestUrl.searchParams.get("address")?.trim() || "";

    if (!address) {
      return jsonResponse(
        {
          ok: false,
          error: "A complete property address is required."
        },
        400,
        request,
        env
      );
    }

    /*
      Limit unreasonable input length.
    */

    if (address.length > 250) {
      return jsonResponse(
        {
          ok: false,
          error: "The property address is too long."
        },
        400,
        request,
        env
      );
    }

    try {
      const encodedAddress =
        encodeURIComponent(address);

      /*
        We make two requests:

        1. RentCast AVM:
           - property characteristics
           - current estimated value
           - last sale information

        2. RentCast sale listings:
           - current or last-known listing status
           - listing price
           - listing dates
           - days on market

        Both are performed simultaneously.
      */

      const valuationUrl =
        `${RENTCAST_BASE_URL}/avm/value` +
        `?address=${encodedAddress}`;

      const listingUrl =
        `${RENTCAST_BASE_URL}/listings/sale` +
        `?address=${encodedAddress}&limit=5`;

      const rentCastHeaders = {
        Accept: "application/json",
        "X-Api-Key": env.RENTCAST_API_KEY
      };

      const [
        valuationResponse,
        listingResponse
      ] = await Promise.all([
        fetch(
          valuationUrl,
          {
            method: "GET",
            headers: rentCastHeaders
          }
        ),

        fetch(
          listingUrl,
          {
            method: "GET",
            headers: rentCastHeaders
          }
        )
      ]);

      /*
        Parse each response independently.

        One RentCast endpoint might have information even if the
        other does not, so we do not discard the whole lookup merely
        because one source returned no match.
      */

      const valuationData =
        await safelyReadJson(
          valuationResponse
        );

      const listingData =
        await safelyReadJson(
          listingResponse
        );

      /*
        If both calls genuinely failed, return an error.
      */

      if (
        !valuationResponse.ok &&
        !listingResponse.ok
      ) {
        return jsonResponse(
          {
            ok: false,
            error:
              createRentCastErrorMessage(
                valuationResponse,
                listingResponse
              )
          },
          determineFailureStatus(
            valuationResponse,
            listingResponse
          ),
          request,
          env
        );
      }

      /*
        AVM results return the property's known structural
        information in subjectProperty.
      */

      const subjectProperty =
        valuationResponse.ok &&
        valuationData &&
        typeof valuationData === "object"
          ? valuationData.subjectProperty || null
          : null;

      /*
        Exact-address sale searches usually return one result,
        but we safely handle multiple matches.

        Prefer an active sale listing. If no active listing exists,
        use the most recently returned listing.
      */

      const listings =
        listingResponse.ok &&
        Array.isArray(listingData)
          ? listingData
          : [];

      const activeListing =
        listings.find(
          (listing) =>
            String(
              listing?.status || ""
            ).toLowerCase() === "active"
        ) || null;

      const listing =
        activeListing ||
        listings[0] ||
        null;

      /*
        Use the AVM subject property as the primary structural
        source, with listing data as a fallback.
      */

      const structuralSource =
        subjectProperty ||
        listing ||
        {};

      if (
        !subjectProperty &&
        !listing
      ) {
        return jsonResponse(
          {
            ok: false,
            error:
              "No matching property data was found for that " +
              "address. Check the address and try again."
          },
          404,
          request,
          env
        );
      }

      const property =
        buildPropertyResponse({
          requestedAddress: address,
          structuralSource,
          subjectProperty,
          listing,
          valuationData
        });

      return jsonResponse(
        {
          ok: true,

          source: "RentCast",

          requestedAddress: address,

          property
        },
        200,
        request,
        env
      );
    } catch (error) {
      console.error(
        "MREO property lookup error:",
        error
      );

      return jsonResponse(
        {
          ok: false,
          error:
            "MREO could not retrieve property information at " +
            "this time. Please try again."
        },
        500,
        request,
        env
      );
    }
  }
};


/*
  ============================================
  BUILD NORMALIZED PROPERTY RESPONSE
  ============================================
*/

function buildPropertyResponse({
  requestedAddress,
  structuralSource,
  subjectProperty,
  listing,
  valuationData
}) {
  const addressLine1 =
    firstDefined(
      structuralSource.addressLine1,
      subjectProperty?.addressLine1,
      listing?.addressLine1
    );

  const addressLine2 =
    firstDefined(
      structuralSource.addressLine2,
      subjectProperty?.addressLine2,
      listing?.addressLine2
    );

  const streetAddress =
    [
      addressLine1,
      addressLine2
    ]
      .filter(Boolean)
      .join(", ");

  const city =
    firstDefined(
      structuralSource.city,
      subjectProperty?.city,
      listing?.city
    );

  const state =
    firstDefined(
      structuralSource.state,
      subjectProperty?.state,
      listing?.state
    );

  const zipCode =
    firstDefined(
      structuralSource.zipCode,
      subjectProperty?.zipCode,
      listing?.zipCode
    );

  const formattedAddress =
    firstDefined(
      structuralSource.formattedAddress,
      subjectProperty?.formattedAddress,
      listing?.formattedAddress,
      requestedAddress
    );

  return {
    /*
      PROPERTY IDENTIFICATION
    */

    id:
      firstDefined(
        structuralSource.id,
        subjectProperty?.id,
        listing?.id
      ),

    formattedAddress,

    addressLine1:
      streetAddress ||
      addressLine1,

    addressLine2,

    city,

    state,

    zipCode,

    county:
      firstDefined(
        structuralSource.county,
        subjectProperty?.county,
        listing?.county
      ),

    latitude:
      firstFiniteNumber(
        structuralSource.latitude,
        subjectProperty?.latitude,
        listing?.latitude
      ),

    longitude:
      firstFiniteNumber(
        structuralSource.longitude,
        subjectProperty?.longitude,
        listing?.longitude
      ),

    /*
      PROPERTY CHARACTERISTICS
    */

    propertyType:
      firstDefined(
        structuralSource.propertyType,
        subjectProperty?.propertyType,
        listing?.propertyType
      ),

    bedrooms:
      firstFiniteNumber(
        structuralSource.bedrooms,
        subjectProperty?.bedrooms,
        listing?.bedrooms
      ),

    bathrooms:
      firstFiniteNumber(
        structuralSource.bathrooms,
        subjectProperty?.bathrooms,
        listing?.bathrooms
      ),

    squareFootage:
      firstFiniteNumber(
        structuralSource.squareFootage,
        subjectProperty?.squareFootage,
        listing?.squareFootage
      ),

    lotSize:
      firstFiniteNumber(
        structuralSource.lotSize,
        subjectProperty?.lotSize,
        listing?.lotSize
      ),

    yearBuilt:
      firstFiniteNumber(
        structuralSource.yearBuilt,
        subjectProperty?.yearBuilt,
        listing?.yearBuilt
      ),

    /*
      SALE / LISTING INFORMATION
    */

    listingStatus:
      listing
        ? firstDefined(
            listing.status,
            "Listing found"
          )
        : "",

    listingPrice:
      firstFiniteNumber(
        listing?.price
      ),

    listingType:
      firstDefined(
        listing?.listingType
      ),

    listedDate:
      firstDefined(
        listing?.listedDate
      ),

    removedDate:
      firstDefined(
        listing?.removedDate
      ),

    lastSeenDate:
      firstDefined(
        listing?.lastSeenDate
      ),

    daysOnMarket:
      firstFiniteNumber(
        listing?.daysOnMarket
      ),

    /*
      AUTOMATED VALUE ESTIMATE
    */

    estimatedValue:
      firstFiniteNumber(
        valuationData?.price
      ),

    estimatedValueLow:
      firstFiniteNumber(
        valuationData?.priceRangeLow
      ),

    estimatedValueHigh:
      firstFiniteNumber(
        valuationData?.priceRangeHigh
      ),

    /*
      LAST RECORDED SALE
    */

    lastSalePrice:
      firstFiniteNumber(
        subjectProperty?.lastSalePrice,
        structuralSource.lastSalePrice
      ),

    lastSaleDate:
      firstDefined(
        subjectProperty?.lastSaleDate,
        structuralSource.lastSaleDate
      )
  };
}


/*
  ============================================
  RENTCAST RESPONSE HELPERS
  ============================================
*/

async function safelyReadJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}


function createRentCastErrorMessage(
  valuationResponse,
  listingResponse
) {
  if (
    valuationResponse.status === 401 ||
    listingResponse.status === 401
  ) {
    return (
      "The MREO property-data connection is not authorized. " +
      "Check the configured RentCast API key."
    );
  }

  if (
    valuationResponse.status === 429 ||
    listingResponse.status === 429
  ) {
    return (
      "The property-data request limit has been reached. " +
      "Please try again later."
    );
  }

  if (
    valuationResponse.status === 404 &&
    listingResponse.status === 404
  ) {
    return (
      "No property information was found for that address."
    );
  }

  return (
    "The property-data provider could not complete the lookup."
  );
}


function determineFailureStatus(
  valuationResponse,
  listingResponse
) {
  if (
    valuationResponse.status === 401 ||
    listingResponse.status === 401
  ) {
    return 502;
  }

  if (
    valuationResponse.status === 429 ||
    listingResponse.status === 429
  ) {
    return 429;
  }

  if (
    valuationResponse.status === 404 &&
    listingResponse.status === 404
  ) {
    return 404;
  }

  return 502;
}


/*
  ============================================
  VALUE HELPERS
  ============================================
*/

function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return "";
}


function firstFiniteNumber(...values) {
  for (const value of values) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    const number =
      Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}


/*
  ============================================
  CORS
  ============================================
*/

function handleOptionsRequest(
  request,
  env
) {
  const origin =
    request.headers.get("Origin") || "";

  if (
    env.ALLOWED_ORIGIN &&
    origin &&
    origin !== env.ALLOWED_ORIGIN
  ) {
    return new Response(
      null,
      {
        status: 403
      }
    );
  }

  return new Response(
    null,
    {
      status: 204,

      headers:
        createCorsHeaders(
          request,
          env
        )
    }
  );
}


function createCorsHeaders(
  request,
  env
) {
  const requestOrigin =
    request.headers.get("Origin") || "";

  /*
    For production, set ALLOWED_ORIGIN to your exact
    GitHub Pages origin.

    Example:

    https://yourusername.github.io

    If ALLOWED_ORIGIN has not yet been set, "*" is used
    temporarily so testing works.
  */

  const allowedOrigin =
    env.ALLOWED_ORIGIN ||
    "*";

  const responseOrigin =
    allowedOrigin === "*"
      ? "*"
      : requestOrigin === allowedOrigin
        ? allowedOrigin
        : allowedOrigin;

  return {
    "Access-Control-Allow-Origin":
      responseOrigin,

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Max-Age":
      "86400",

    "Vary":
      "Origin"
  };
}


/*
  ============================================
  JSON RESPONSE
  ============================================
*/

function jsonResponse(
  data,
  status,
  request,
  env
) {
  const headers = {
    "Content-Type":
      "application/json; charset=UTF-8",

    "Cache-Control":
      "no-store",

    ...createCorsHeaders(
      request,
      env
    )
  };

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
}
