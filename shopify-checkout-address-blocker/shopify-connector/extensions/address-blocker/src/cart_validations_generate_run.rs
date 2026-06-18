use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Debug)]
struct AddressRule {
    address1: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    province_code: Option<String>,
    country_code: Option<String>,
    email: Option<String>,
    phone: Option<String>,
}

#[derive(Debug)]
struct CartAddress {
    address1: String,
    zip: String,
    city: Option<String>,
    province_code: Option<String>,
    country_code: Option<String>,
    phone: Option<String>,
}

#[derive(Debug)]
struct CartContact {
    email: Option<String>,
    phone: Option<String>,
}

#[shopify_function]
fn cart_validations_generate_run(
    input: schema::cart_validations_generate_run::Input,
) -> Result<schema::CartValidationsGenerateRunResult> {
    let mut operations = Vec::new();
    let mut errors = Vec::new();
    let rules = parse_rules(
        input
            .shop()
            .blocked_addresses()
            .as_ref()
            .map(|metafield| metafield.value())
            .map_or("", |value| value),
    );

    if !rules.is_empty() && cart_has_blocked_value(input.cart(), &rules) {
        errors.push(schema::ValidationError {
            message: "We cannot accept orders with this contact or address.".to_owned(),
            target: "$.cart".to_owned(),
        })
    }

    let operation = schema::ValidationAddOperation { errors };
    operations.push(schema::Operation::ValidationAdd(operation));

    Ok(schema::CartValidationsGenerateRunResult { operations })
}

fn cart_has_blocked_value(
    cart: &schema::cart_validations_generate_run::input::Cart,
    rules: &[AddressRule],
) -> bool {
    let contact = normalize_contact(cart);
    if rules.iter().any(|rule| rule.matches_contact(&contact)) {
        return true;
    }

    if let Some(address) = cart.billing_address() {
        if let Some(address) = normalize_billing_address(address) {
            if rules.iter().any(|rule| rule.matches_address(&address)) {
                return true;
            }
        }
    }

    cart.delivery_groups().iter().any(|group| {
        group
            .delivery_address()
            .and_then(normalize_delivery_address)
            .map(|address| rules.iter().any(|rule| rule.matches_address(&address)))
            .unwrap_or(false)
    })
}

fn normalize_contact(cart: &schema::cart_validations_generate_run::input::Cart) -> CartContact {
    let identity = cart.buyer_identity();

    CartContact {
        email: identity.and_then(|value| normalize_email(value.email())),
        phone: identity.and_then(|value| normalize_phone(value.phone())),
    }
}

fn normalize_delivery_address(
    address: &schema::cart_validations_generate_run::input::cart::delivery_groups::DeliveryAddress,
) -> Option<CartAddress> {
    let address1 = normalize_required(address.address_1())?;
    let zip = normalize_required(address.zip())?;

    Some(CartAddress {
        address1,
        zip,
        city: normalize_optional(address.city()),
        province_code: normalize_optional(address.province_code()),
        country_code: normalize_optional(address.country_code()),
        phone: normalize_phone(address.phone()),
    })
}

fn normalize_billing_address(
    address: &schema::cart_validations_generate_run::input::cart::BillingAddress,
) -> Option<CartAddress> {
    let address1 = normalize_required(address.address_1())?;
    let zip = normalize_required(address.zip())?;

    Some(CartAddress {
        address1,
        zip,
        city: normalize_optional(address.city()),
        province_code: normalize_optional(address.province_code()),
        country_code: normalize_optional(address.country_code()),
        phone: normalize_phone(address.phone()),
    })
}

fn parse_rules(value: &str) -> Vec<AddressRule> {
    value
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            let mut parts = line.split('|').map(normalize_part);
            let address1 = parts.next().and_then(optional_part);
            let zip = parts.next().and_then(optional_part);
            let city = parts.next().and_then(optional_part);
            let province_code = parts.next().and_then(optional_part);
            let country_code = parts.next().and_then(optional_part);
            let _order_id = parts.next();
            let _order_name = parts.next();
            let email = parts.next().and_then(|value| normalize_email(Some(&value)));
            let phone = parts.next().and_then(|value| normalize_phone(Some(&value)));

            let has_address_rule = address1.is_some() && zip.is_some();
            if !has_address_rule && email.is_none() && phone.is_none() {
                return None;
            }

            Some(AddressRule {
                address1,
                zip,
                city,
                province_code,
                country_code,
                email,
                phone,
            })
        })
        .collect()
}

impl AddressRule {
    fn matches_address(&self, address: &CartAddress) -> bool {
        if contact_matches(&self.phone, &address.phone) {
            return true;
        }

        let Some(address1) = &self.address1 else {
            return false;
        };
        let Some(zip) = &self.zip else {
            return false;
        };

        address1 == &address.address1
            && zip == &address.zip
            && optional_matches(&self.city, &address.city)
            && optional_matches(&self.province_code, &address.province_code)
            && optional_matches(&self.country_code, &address.country_code)
    }

    fn matches_contact(&self, contact: &CartContact) -> bool {
        contact_matches(&self.email, &contact.email) || contact_matches(&self.phone, &contact.phone)
    }
}

fn optional_matches(rule_value: &Option<String>, address_value: &Option<String>) -> bool {
    rule_value
        .as_ref()
        .map(|expected| address_value.as_ref() == Some(expected))
        .unwrap_or(true)
}

fn contact_matches(rule_value: &Option<String>, cart_value: &Option<String>) -> bool {
    rule_value.is_some() && rule_value == cart_value
}

fn normalize_required(value: Option<&String>) -> Option<String> {
    value.and_then(|raw| required_part(normalize_part(raw)))
}

fn normalize_optional(value: Option<&String>) -> Option<String> {
    value.and_then(|raw| optional_part(normalize_part(raw)))
}

fn normalize_part(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_email(value: Option<&String>) -> Option<String> {
    value.and_then(|raw| optional_part(normalize_part(raw)))
}

fn normalize_phone(value: Option<&String>) -> Option<String> {
    value.and_then(|raw| {
        let normalized = raw.chars().filter(|char| char.is_ascii_digit()).collect::<String>();
        optional_part(normalized)
    })
}

fn required_part(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn optional_part(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
