/*
  MREO PROPERTY PROTOCOL
  GitHub Pages prototype functionality
*/

(() => {
  "use strict";

  /*
    Live MREO property-data endpoint.

    This Cloudflare Worker securely connects to RentCast.
    The RentCast API key itself is NOT exposed here.
  */

  const PROPERTY_DATA_ENDPOINT =
    "https://mreo-property-api.blakeaustinmyers01.workers.dev";

  const state = {
    activeModal: null,
    previouslyFocusedElement: null,
    mediaPreviewUrls: []
  };

  initialize();

  function initialize() {
    updateCopyrightYear();

    initializeSellerSearch();
    initializeSellerForm();

    initializeBuyerForm();
    initializeBuyerPropertySelection();

    initializeMediaPreview();

    initializeContracts();
    initializeModalControls();
  }

  /*
    ============================================
    GENERAL UTILITIES
    ============================================
  */

  function updateCopyrightYear() {
    const yearElement =
      document.getElementById("current-year");

    if (yearElement) {
      yearElement.textContent =
        new Date().getFullYear();
    }
  }

  function getFieldValue(id) {
    const field =
      document.getElementById(id);

    return field
      ? field.value.trim()
      : "";
  }

  function setFieldValue(
    id,
    value,
    options = {}
  ) {
    const field =
      document.getElementById(id);

    if (!field) {
      return false;
    }

    const {
      overwrite = true,
      markAutofilled = false
    } = options;

    if (
      !overwrite &&
      String(field.value || "").trim() !== ""
    ) {
      return false;
    }

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {
      return false;
    }

    field.value =
      String(value).trim();

    if (markAutofilled) {
      field.dataset.autofilled = "true";
    }

    field.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    field.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );

    return true;
  }

  function setText(
    id,
    value,
    fallback = "____________________"
  ) {
    const element =
      document.getElementById(id);

    if (element) {
      element.textContent =
        value || fallback;
    }
  }

  function formatCurrency(value) {
    const number =
      Number(value);

    if (
      value === "" ||
      value === null ||
      value === undefined ||
      !Number.isFinite(number)
    ) {
      return "____________________";
    }

    return new Intl.NumberFormat(
      "en-US",
      {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
      }
    ).format(number);
  }

  function formatNumber(value) {
    const number =
      Number(value);

    if (!Number.isFinite(number)) {
      return "";
    }

    return new Intl.NumberFormat(
      "en-US"
    ).format(number);
  }

  function formatDate() {
    return new Intl.DateTimeFormat(
      "en-US",
      {
        month: "long",
        day: "numeric",
        year: "numeric"
      }
    ).format(new Date());
  }

  function showMessage(
    element,
    message,
    type = "success"
  ) {
    if (!element) {
      return;
    }

    element.textContent = message;
    element.hidden = false;

    element.classList.remove(
      "success-message",
      "error-message",
      "status-success",
      "status-error"
    );

    if (type === "error") {
      element.classList.add(
        "error-message"
      );
    } else {
      element.classList.add(
        "success-message"
      );
    }
  }

  function cleanNumericValue(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "";
    }

    if (typeof value === "number") {
      return Number.isFinite(value)
        ? value
        : "";
    }

    const cleaned =
      String(value)
        .replace(/[$,\s]/g, "")
        .replace(/[^\d.-]/g, "");

    const number =
      Number(cleaned);

    return Number.isFinite(number)
      ? number
      : "";
  }

  /*
    ============================================
    EXTERNAL PROPERTY LINKS
    ============================================
  */

  function buildZillowSearchUrl(address) {
    const encodedAddress =
      encodeURIComponent(address);

    return (
      `https://www.zillow.com/homes/${encodedAddress}_rb/`
    );
  }

  function buildGoogleMapsUrl(address) {
    const encodedAddress =
      encodeURIComponent(address);

    return (
      "https://www.google.com/maps/search/" +
      `?api=1&query=${encodedAddress}`
    );
  }

  /*
    ============================================
    SELLER PROPERTY SEARCH
    ============================================
  */

  function initializeSellerSearch() {
    const searchForm =
      document.getElementById(
        "seller-search-form"
      );

    if (!searchForm) {
      return;
    }

    searchForm.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        if (
          !searchForm.reportValidity()
        ) {
          return;
        }

        const address =
          getFieldValue(
            "seller-property-search-address"
          );

        if (!address) {
          return;
        }

        const searchButton =
          searchForm.querySelector(
            'button[type="submit"]'
          );

        const originalButtonText =
          searchButton
            ? searchButton.textContent
            : "";

        if (searchButton) {
          searchButton.disabled = true;
          searchButton.textContent =
            "Searching...";
        }

        const zillowUrl =
          buildZillowSearchUrl(
            address
          );

        const mapsUrl =
          buildGoogleMapsUrl(
            address
          );

        /*
          Open Zillow immediately in a new tab.

          Doing this directly from the button click makes
          browsers less likely to block the new tab.
        */

        window.open(
          zillowUrl,
          "_blank",
          "noopener,noreferrer"
        );

        updateSellerSearchResults(
          address,
          zillowUrl,
          mapsUrl
        );

        showSellerAutofillStatus(
          "Searching available property records..."
        );

        try {
          const response =
            await fetchPropertyData(
              address
            );

          if (
            !response ||
            response.ok !== true ||
            !response.property
          ) {
            throw new Error(
              response?.error ||
              "No property information was returned."
            );
          }

          const numberPopulated =
            populateSellerPropertyData(
              response.property
            );

          updateSellerContract();

          showSellerAutofillStatus(
            createAutofillSuccessMessage(
              numberPopulated,
              response.property
            )
          );

          scrollToSellerPropertyForm();
        } catch (error) {
          console.error(
            "MREO property search failed:",
            error
          );

          /*
            Even if RentCast fails, we can still populate the
            address from what the Seller typed.
          */

          const parsedAddress =
            parseUnitedStatesAddress(
              address
            );

          populateSellerAddressFields(
            parsedAddress
          );

          updateSellerContract();

          showSellerAutofillStatus(
            "MREO could not retrieve additional property records. " +
            "The address has been added to the form, and Zillow " +
            "has opened in a new tab. Please complete the remaining " +
            "property information manually."
          );

          scrollToSellerPropertyForm();
        } finally {
          if (searchButton) {
            searchButton.disabled =
              false;

            searchButton.textContent =
              originalButtonText ||
              "Search";
          }
        }
      }
    );
  }

  async function fetchPropertyData(
    address
  ) {
    const requestUrl =
      new URL(
        PROPERTY_DATA_ENDPOINT
      );

    requestUrl.searchParams.set(
      "address",
      address
    );

    const response =
      await fetch(
        requestUrl.toString(),
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    let data = null;

    try {
      data =
        await response.json();
    } catch (error) {
      throw new Error(
        "The property service returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        "The property lookup could not be completed."
      );
    }

    return data;
  }

  function updateSellerSearchResults(
    address,
    zillowUrl,
    mapsUrl
  ) {
    const results =
      document.getElementById(
        "seller-search-result"
      );

    const addressLabel =
      document.getElementById(
        "seller-searched-property-address"
      );

    const zillowLink =
      document.getElementById(
        "seller-zillow-property-link"
      );

    const mapsLink =
      document.getElementById(
        "seller-google-maps-link"
      );

    if (addressLabel) {
      addressLabel.textContent =
        address;
    }

    if (zillowLink) {
      zillowLink.href =
        zillowUrl;
    }

    if (mapsLink) {
      mapsLink.href =
        mapsUrl;
    }

    if (results) {
      results.hidden = false;
    }
  }

  function showSellerAutofillStatus(
    message
  ) {
    const status =
      document.getElementById(
        "seller-autofill-message"
      );

    if (!status) {
      return;
    }

    status.textContent =
      message;
  }

  function createAutofillSuccessMessage(
    count,
    property
  ) {
    let message =
      `MREO found the property and automatically filled ` +
      `${count} field${count === 1 ? "" : "s"} below.`;

    if (
      property.estimatedValue !== null &&
      property.estimatedValue !== undefined
    ) {
      message +=
        ` The current automated value estimate is ` +
        `${formatCurrency(property.estimatedValue)}.`;
    }

    if (
      property.listingPrice !== null &&
      property.listingPrice !== undefined
    ) {
      message +=
        ` A public sale listing price of ` +
        `${formatCurrency(property.listingPrice)} was also found.`;
    }

    message +=
      " Please review all automatically populated information before submitting.";

    return message;
  }

  function scrollToSellerPropertyForm() {
    const heading =
      document.getElementById(
        "property-information-heading"
      );

    if (!heading) {
      return;
    }

    heading.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  /*
    ============================================
    LIVE PROPERTY DATA -> SELLER FORM
    ============================================
  */

  function populateSellerPropertyData(
    property
  ) {
    let count = 0;

    const addField = (
      id,
      value,
      options = {}
    ) => {
      if (
        setFieldValue(
          id,
          value,
          {
            overwrite:
              options.overwrite !== false,

            markAutofilled: true
          }
        )
      ) {
        count += 1;
      }
    };

    /*
      ADDRESS
    */

    addField(
      "property-address",
      property.addressLine1
    );

    addField(
      "property-city",
      property.city
    );

    addField(
      "property-state",
      String(
        property.state || ""
      ).toUpperCase()
    );

    addField(
      "property-zip",
      property.zipCode
    );

    /*
      PROPERTY CHARACTERISTICS
    */

    addField(
      "property-type",
      normalizePropertyType(
        property.propertyType
      )
    );

    addField(
      "property-bedrooms",
      property.bedrooms
    );

    addField(
      "property-bathrooms",
      property.bathrooms
    );

    addField(
      "property-size",
      property.squareFootage
    );

    addField(
      "property-lot-size",
      formatLotSize(
        property.lotSize
      )
    );

    addField(
      "property-year-built",
      property.yearBuilt
    );

    /*
      PUBLIC SALE INFORMATION
    */

    addField(
      "property-public-status",
      formatPropertyStatus(
        property.listingStatus
      )
    );

    addField(
      "property-public-price",
      property.listingPrice
    );

    /*
      ESTIMATED VALUE
    */

    addField(
      "property-estimated-value",
      property.estimatedValue
    );

    /*
      ASKING PRICE

      If the property is currently listed publicly,
      initialize Seller asking price with that listing
      price.

      If there is no listing price, do NOT automatically
      use the estimated value as the Seller's asking price.
      Those are conceptually different things.
    */

    if (
      property.listingPrice !== null &&
      property.listingPrice !== undefined
    ) {
      if (
        setFieldValue(
          "asking-price",
          property.listingPrice,
          {
            overwrite: false,
            markAutofilled: true
          }
        )
      ) {
        count += 1;
      }
    }

    return count;
  }

  function normalizePropertyType(
    value
  ) {
    const normalized =
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(
          /[_-]+/g,
          " "
        );

    if (!normalized) {
      return "";
    }

    if (
      normalized.includes(
        "single"
      ) &&
      normalized.includes(
        "family"
      )
    ) {
      return "Single-family home";
    }

    if (
      normalized.includes(
        "condo"
      ) ||
      normalized.includes(
        "condominium"
      )
    ) {
      return "Condominium";
    }

    if (
      normalized.includes(
        "townhouse"
      ) ||
      normalized.includes(
        "townhome"
      )
    ) {
      return "Townhouse";
    }

    if (
      normalized.includes(
        "multi"
      ) &&
      normalized.includes(
        "family"
      )
    ) {
      return "Multifamily";
    }

    if (
      normalized.includes(
        "commercial"
      )
    ) {
      return "Commercial";
    }

    if (
      normalized === "land" ||
      normalized.includes(
        "vacant land"
      ) ||
      normalized.includes(
        "lot"
      )
    ) {
      return "Land";
    }

    return "Other";
  }

  function formatPropertyStatus(
    value
  ) {
    const status =
      String(value || "")
        .trim()
        .replace(
          /[_-]+/g,
          " "
        )
        .toLowerCase();

    if (!status) {
      return "";
    }

    return status.replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
  }

  function formatLotSize(
    squareFeet
  ) {
    const lotSize =
      Number(squareFeet);

    if (
      !Number.isFinite(lotSize) ||
      lotSize <= 0
    ) {
      return "";
    }

    const acres =
      lotSize / 43560;

    if (acres >= 1) {
      return (
        `${formatNumber(lotSize)} sq ft ` +
        `(${acres.toFixed(2)} acres)`
      );
    }

    return (
      `${formatNumber(lotSize)} sq ft ` +
      `(${acres.toFixed(2)} acres)`
    );
  }

  /*
    ============================================
    FALLBACK ADDRESS PARSING
    ============================================
  */

  function parseUnitedStatesAddress(
    address
  ) {
    const cleanedAddress =
      String(address || "")
        .replace(/\s+/g, " ")
        .trim();

    const result = {
      street: "",
      city: "",
      state: "",
      zip: ""
    };

    if (!cleanedAddress) {
      return result;
    }

    const pieces =
      cleanedAddress
        .split(",")
        .map(
          (piece) =>
            piece.trim()
        )
        .filter(Boolean);

    /*
      Format:

      123 Main Street, Dallas, TX 75201

      OR

      123 Main Street, Dallas, TX, 75201
    */

    if (pieces.length >= 4) {
      const zipPiece =
        pieces[
          pieces.length - 1
        ];

      const statePiece =
        pieces[
          pieces.length - 2
        ];

      const cityPiece =
        pieces[
          pieces.length - 3
        ];

      const streetPieces =
        pieces.slice(
          0,
          pieces.length - 3
        );

      if (
        /^[A-Za-z]{2}$/.test(
          statePiece
        ) &&
        /^\d{5}(?:-\d{4})?$/.test(
          zipPiece
        )
      ) {
        result.street =
          streetPieces.join(", ");

        result.city =
          cityPiece;

        result.state =
          statePiece.toUpperCase();

        result.zip =
          zipPiece;

        return result;
      }
    }

    if (pieces.length >= 3) {
      const stateZipPiece =
        pieces[
          pieces.length - 1
        ];

      const cityPiece =
        pieces[
          pieces.length - 2
        ];

      const streetPieces =
        pieces.slice(
          0,
          pieces.length - 2
        );

      const match =
        stateZipPiece.match(
          /^([A-Za-z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)$/
        );

      if (match) {
        result.street =
          streetPieces.join(", ");

        result.city =
          cityPiece;

        result.state =
          match[1].toUpperCase();

        result.zip =
          match[2];

        return result;
      }
    }

    result.street =
      cleanedAddress;

    return result;
  }

  function populateSellerAddressFields(
    addressData
  ) {
    let count = 0;

    if (
      setFieldValue(
        "property-address",
        addressData.street,
        {
          markAutofilled: true
        }
      )
    ) {
      count += 1;
    }

    if (
      setFieldValue(
        "property-city",
        addressData.city,
        {
          markAutofilled: true
        }
      )
    ) {
      count += 1;
    }

    if (
      setFieldValue(
        "property-state",
        addressData.state,
        {
          markAutofilled: true
        }
      )
    ) {
      count += 1;
    }

    if (
      setFieldValue(
        "property-zip",
        addressData.zip,
        {
          markAutofilled: true
        }
      )
    ) {
      count += 1;
    }

    return count;
  }

  /*
    ============================================
    SELLER PROPERTY FORM
    ============================================
  */

  function initializeSellerForm() {
    const sellerForm =
      document.getElementById(
        "seller-form"
      );

    if (!sellerForm) {
      return;
    }

    sellerForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        if (
          !sellerForm.reportValidity()
        ) {
          return;
        }

        const sellerName =
          getFieldValue(
            "seller-name"
          );

        const propertyAddress =
          buildSellerPropertyAddress();

        updateSellerContract();

        const message =
          document.getElementById(
            "seller-message"
          );

        showMessage(
          message,
          `${sellerName}, your property information for ` +
            `${propertyAddress} has been prepared successfully. ` +
            "This demonstration does not transmit or permanently " +
            "store your information."
        );

        message.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    );

    sellerForm.addEventListener(
      "input",
      updateSellerContract
    );

    sellerForm.addEventListener(
      "change",
      updateSellerContract
    );

    updateSellerContract();
  }

  function buildSellerPropertyAddress() {
    const street =
      getFieldValue(
        "property-address"
      );

    const city =
      getFieldValue(
        "property-city"
      );

    const stateCode =
      getFieldValue(
        "property-state"
      );

    const zipCode =
      getFieldValue(
        "property-zip"
      );

    const cityStateZip = [
      city,

      [stateCode, zipCode]
        .filter(Boolean)
        .join(" ")
    ]
      .filter(Boolean)
      .join(", ");

    return [
      street,
      cityStateZip
    ]
      .filter(Boolean)
      .join(", ");
  }

  function updateSellerContract() {
    setText(
      "contract-date",
      formatDate()
    );

    setText(
      "contract-seller-name",
      getFieldValue(
        "seller-name"
      )
    );

    setText(
      "contract-property-address",
      buildSellerPropertyAddress(),
      "________________________________________________"
    );

    setText(
      "contract-purchase-price",
      formatCurrency(
        getFieldValue(
          "asking-price"
        )
      )
    );
  }

  /*
    ============================================
    PROPERTY PHOTOGRAPH AND VIDEO PREVIEWS
    ============================================
  */

  function initializeMediaPreview() {
    const mediaInput =
      document.getElementById(
        "property-media"
      );

    const previewContainer =
      document.getElementById(
        "media-preview"
      );

    if (
      !mediaInput ||
      !previewContainer
    ) {
      return;
    }

    mediaInput.addEventListener(
      "change",
      () => {
        clearMediaPreviews(
          previewContainer
        );

        const files =
          Array.from(
            mediaInput.files || []
          );

        files.forEach(
          (file) => {
            if (
              !isSupportedMediaFile(
                file
              )
            ) {
              return;
            }

            const previewUrl =
              URL.createObjectURL(
                file
              );

            state.mediaPreviewUrls.push(
              previewUrl
            );

            const figure =
              document.createElement(
                "figure"
              );

            figure.style.margin =
              "0";

            let preview;

            if (
              file.type.startsWith(
                "image/"
              )
            ) {
              preview =
                document.createElement(
                  "img"
                );

              preview.src =
                previewUrl;

              preview.alt =
                file.name;

              preview.loading =
                "lazy";
            } else {
              preview =
                document.createElement(
                  "video"
                );

              preview.src =
                previewUrl;

              preview.controls =
                true;

              preview.preload =
                "metadata";

              preview.muted =
                true;
            }

            const caption =
              document.createElement(
                "figcaption"
              );

            caption.textContent =
              shortenFilename(
                file.name
              );

            caption.style.marginTop =
              "6px";

            caption.style.fontSize =
              "11px";

            caption.style.color =
              "#66645d";

            caption.style.overflowWrap =
              "anywhere";

            figure.appendChild(
              preview
            );

            figure.appendChild(
              caption
            );

            previewContainer.appendChild(
              figure
            );
          }
        );
      }
    );

    window.addEventListener(
      "pagehide",
      () => {
        clearMediaPreviews(
          previewContainer
        );
      }
    );
  }

  function isSupportedMediaFile(
    file
  ) {
    return (
      file.type.startsWith(
        "image/"
      ) ||
      file.type.startsWith(
        "video/"
      )
    );
  }

  function shortenFilename(
    filename
  ) {
    if (
      filename.length <= 28
    ) {
      return filename;
    }

    return (
      `${filename.slice(0, 20)}…` +
      filename.slice(-6)
    );
  }

  function clearMediaPreviews(
    container
  ) {
    state.mediaPreviewUrls.forEach(
      (url) => {
        URL.revokeObjectURL(
          url
        );
      }
    );

    state.mediaPreviewUrls = [];

    if (container) {
      container.replaceChildren();
    }
  }

  /*
    ============================================
    BUYER PROPERTY SELECTION
    ============================================

    The forthcoming properties.html page will send:

      buyer.html?address=...&price=...

    This lets the selected property flow directly
    into the Buyer interest form.
  */

  function initializeBuyerPropertySelection() {
    const addressField =
      document.getElementById(
        "buyer-offer-address"
      );

    if (!addressField) {
      return;
    }

    const parameters =
      new URLSearchParams(
        window.location.search
      );

    const propertyAddress =
      parameters.get(
        "address"
      );

    const propertyPrice =
      parameters.get(
        "price"
      );

    if (propertyAddress) {
      setFieldValue(
        "buyer-offer-address",
        propertyAddress,
        {
          markAutofilled: true
        }
      );
    }

    if (propertyPrice) {
      setFieldValue(
        "buyer-offer-amount",
        cleanNumericValue(
          propertyPrice
        ),
        {
          markAutofilled: true
        }
      );
    }

    if (
      propertyAddress ||
      propertyPrice
    ) {
      updateBuyerContract();
    }
  }

  /*
    ============================================
    BUYER INTEREST FORM
    ============================================
  */

  function initializeBuyerForm() {
    const buyerForm =
      document.getElementById(
        "buyer-form"
      );

    if (!buyerForm) {
      return;
    }

    buyerForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        if (
          !buyerForm.reportValidity()
        ) {
          return;
        }

        const buyerName =
          getFieldValue(
            "buyer-name"
          );

        const address =
          getFieldValue(
            "buyer-offer-address"
          );

        updateBuyerContract();

        const message =
          document.getElementById(
            "buyer-message"
          );

        showMessage(
          message,
          `${buyerName}, your interest in ${address} has been ` +
            "prepared successfully. This demonstration does not " +
            "transmit your information or create a binding " +
            "purchase offer."
        );

        message.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    );

    buyerForm.addEventListener(
      "input",
      updateBuyerContract
    );

    buyerForm.addEventListener(
      "change",
      updateBuyerContract
    );

    updateBuyerContract();
  }

  function updateBuyerContract() {
    const offerAddress =
      getFieldValue(
        "buyer-offer-address"
      );

    setText(
      "buyer-contract-date",
      formatDate()
    );

    setText(
      "buyer-contract-name",
      getFieldValue(
        "buyer-name"
      )
    );

    setText(
      "buyer-contract-address",
      offerAddress,
      "________________________________________________"
    );

    setText(
      "buyer-contract-price",
      formatCurrency(
        getFieldValue(
          "buyer-offer-amount"
        )
      )
    );
  }

  /*
    ============================================
    SELLER AND BUYER AGREEMENTS
    ============================================
  */

  function initializeContracts() {
    const printButtons =
      document.querySelectorAll(
        "[data-print-contract]"
      );

    printButtons.forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const contractId =
              button.dataset
                .printContract;

            printContract(
              contractId
            );
          }
        );
      }
    );
  }

  function printContract(
    contractId
  ) {
    const contractBody =
      document.getElementById(
        contractId
      );

    if (!contractBody) {
      return;
    }

    const modal =
      contractBody.closest(
        ".contract-modal, .modal-overlay"
      );

    const titleElement =
      modal
        ? modal.querySelector(
            ".contract-header h2, .modal-header h2"
          )
        : null;

    const title =
      titleElement
        ? titleElement
            .textContent
            .trim()
        : "MREO As-Is Property Agreement";

    const printWindow =
      window.open(
        "",
        "_blank",
        "width=850,height=1050"
      );

    if (!printWindow) {
      window.alert(
        "Please allow pop-ups to print the agreement."
      );

      return;
    }

    printWindow.opener =
      null;

    const safeTitle =
      escapeHtml(
        title
      );

    printWindow.document.write(`
      <!DOCTYPE html>

      <html lang="en">
        <head>
          <meta charset="UTF-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>${safeTitle}</title>

          <style>
            @page {
              size: auto;
              margin: 0.55in;
            }

            * {
              box-sizing: border-box;
            }

            body {
              max-width: 760px;

              margin: 0 auto;

              color: #171717;

              font-family:
                "Helvetica Neue",
                Helvetica,
                Arial,
                sans-serif;

              font-size: 10.5pt;
              line-height: 1.45;
            }

            h1 {
              margin: 0 0 18px;
              padding-bottom: 12px;

              border-bottom: 2px solid #171717;

              font-size: 18pt;
              letter-spacing: -0.04em;
            }

            h3 {
              margin: 12px 0 4px;

              font-size: 10.5pt;
            }

            p {
              margin: 0 0 8px;
            }

            .signature-grid {
              margin-top: 34px;

              display: grid;
              grid-template-columns:
                1fr 1fr;

              gap: 30px;
            }

            .signature-line {
              padding-top: 7px;

              border-top:
                1px solid #171717;

              font-size: 9pt;
            }
          </style>
        </head>

        <body>
          <h1>${safeTitle}</h1>

          ${contractBody.innerHTML}
        </body>
      </html>
    `);

    printWindow.document.close();

    printWindow.addEventListener(
      "load",
      () => {
        printWindow.focus();
        printWindow.print();
      },
      {
        once: true
      }
    );
  }

  function escapeHtml(
    value
  ) {
    const temporaryElement =
      document.createElement(
        "span"
      );

    temporaryElement.textContent =
      value;

    return temporaryElement.innerHTML;
  }

  /*
    ============================================
    MODAL OPENING AND CLOSING
    ============================================
  */

  function initializeModalControls() {
    const openButtons =
      document.querySelectorAll(
        "[data-open-modal]"
      );

    const closeButtons =
      document.querySelectorAll(
        "[data-close-modal]"
      );

    openButtons.forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const modalId =
              button.dataset.openModal;

            if (
              modalId ===
              "seller-contract-modal"
            ) {
              updateSellerContract();
            }

            if (
              modalId ===
              "buyer-contract-modal"
            ) {
              updateBuyerContract();
            }

            openModal(
              modalId
            );
          }
        );
      }
    );

    closeButtons.forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const modal =
              button.closest(
                ".contract-modal, .modal-overlay"
              );

            closeModal(
              modal
            );
          }
        );
      }
    );

    document
      .querySelectorAll(
        ".contract-modal, .modal-overlay"
      )
      .forEach(
        (modal) => {
          modal.addEventListener(
            "click",
            (event) => {
              if (
                event.target ===
                modal
              ) {
                closeModal(
                  modal
                );
              }
            }
          );
        }
      );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          !state.activeModal
        ) {
          return;
        }

        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();

          closeModal(
            state.activeModal
          );

          return;
        }

        if (
          event.key ===
          "Tab"
        ) {
          keepFocusInsideModal(
            event
          );
        }
      }
    );
  }

  function openModal(
    modalId
  ) {
    const modal =
      document.getElementById(
        modalId
      );

    if (!modal) {
      return;
    }

    state.previouslyFocusedElement =
      document.activeElement;

    state.activeModal =
      modal;

    modal.hidden = false;

    document.body.style.overflow =
      "hidden";

    const initialFocus =
      modal.querySelector(
        "[data-close-modal], button, a, input"
      );

    if (initialFocus) {
      initialFocus.focus();
    }
  }

  function closeModal(
    modal
  ) {
    if (!modal) {
      return;
    }

    modal.hidden = true;

    document.body.style.overflow =
      "";

    state.activeModal =
      null;

    if (
      state.previouslyFocusedElement &&
      typeof state
        .previouslyFocusedElement
        .focus === "function"
    ) {
      state
        .previouslyFocusedElement
        .focus();
    }

    state.previouslyFocusedElement =
      null;
  }

  function keepFocusInsideModal(
    event
  ) {
    const focusableElements =
      Array.from(
        state.activeModal.querySelectorAll(
          'a[href], button:not([disabled]), ' +
            'input:not([disabled]), ' +
            'select:not([disabled]), ' +
            'textarea:not([disabled]), ' +
            '[tabindex]:not([tabindex="-1"])'
        )
      );

    if (
      focusableElements.length === 0
    ) {
      return;
    }

    const firstElement =
      focusableElements[0];

    const lastElement =
      focusableElements[
        focusableElements.length - 1
      ];

    if (
      event.shiftKey &&
      document.activeElement ===
        firstElement
    ) {
      event.preventDefault();

      lastElement.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement ===
        lastElement
    ) {
      event.preventDefault();

      firstElement.focus();
    }
  }
})();
