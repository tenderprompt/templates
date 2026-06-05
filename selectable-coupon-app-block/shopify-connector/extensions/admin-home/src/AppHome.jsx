/** @jsxImportSource preact */
import {render} from "preact";

const SAMPLE_CONFIG = {
  version: 1,
  collectionIds: ["gid://shopify/Collection/33333333333333"],
  coupons: [
    {
      id: "starter-coupon-20",
      title: "20% off",
      percentage: "20.0",
      surfaces: {
        product: true,
        collection: true,
      },
      showSavingsEstimate: true,
      unappliedText: "Apply 20% coupon",
      appliedText: "Redeemed. Save 20% applied at checkout",
      badgeText: "Apply 20% coupon",
      eligibleProductIds: ["gid://shopify/Product/11111111111111"],
      eligibleVariantIds: ["gid://shopify/ProductVariant/22222222222222"],
      eligibleCollectionIds: ["gid://shopify/Collection/33333333333333"],
    },
  ],
};

function AppHome() {
  const configText = JSON.stringify(SAMPLE_CONFIG, null, 2);

  return (
    <s-page heading="Selectable coupon setup">
      <s-section heading="Setup">
        <s-ordered-list>
          <s-list-item>Publish the Tender runtime.</s-list-item>
          <s-list-item>Replace the hosted asset URLs in the app block.</s-list-item>
          <s-list-item>Create or update the automatic app discount.</s-list-item>
          <s-list-item>Save checkout and storefront config from your app backend.</s-list-item>
          <s-list-item>Place the app block on product and collection templates.</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section heading="Starter config">
        <s-text-area label="Config JSON" value={configText} rows={18}></s-text-area>
      </s-section>
    </s-page>
  );
}

render(<AppHome />, document.body);
