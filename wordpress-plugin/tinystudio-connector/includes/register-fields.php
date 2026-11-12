<?php
/**
 * Registers the SEO fields the active SEO plugin does not already accept writes for.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Returns the slug of the SEO plugin running on the site.
 *
 * The connector is an allowlist, not a router: it registers fields only for
 * plugins it knows have a REST write gap, and returns an empty string for any
 * other plugin, so nothing is registered for unknown SEO plugins.
 *
 * @return string The slug, or an empty string when no known SEO plugin is active.
 */
function tinystudio_connector_active_seo_plugin() {
	if ( defined( 'WPSEO_VERSION' ) ) {
		return 'yoast';
	}

	if ( defined( 'RANK_MATH_VERSION' ) ) {
		return 'rank-math';
	}

	if ( defined( 'AIOSEO_VERSION' ) ) {
		return 'all-in-one-seo';
	}

	return '';
}

/**
 * Returns the public post types the connector works on.
 *
 * Attachments are skipped (Yoast keeps their meta behind separate settings) and
 * so are the wp_* object types, which are not editorial content.
 *
 * @return string[] Post type names.
 */
function tinystudio_connector_supported_post_types() {
	$post_types = get_post_types( array( 'public' => true ), 'names' );

	return array_values(
		array_filter(
			$post_types,
			static function ( $post_type ) {
				if ( 'attachment' === $post_type ) {
					return false;
				}

				return 0 !== strpos( $post_type, 'wp_' );
			}
		)
	);
}

/**
 * Returns the names of the fields the connector registered for a post type.
 *
 * The tests use this to prove the connector covers only the gap the active SEO
 * plugin leaves open and registers nothing it does not need to.
 *
 * @param string $post_type Post type name.
 * @return string[] Meta keys, empty when the connector registered nothing.
 */
function tinystudio_connector_registered_fields( $post_type ) {
	$args = get_registered_meta_keys( 'post', $post_type );

	return array_values(
		array_filter(
			array_keys( $args ),
			static function ( $meta_key ) {
				return 0 === strpos( $meta_key, '_yoast_wpseo_' );
			}
		)
	);
}

/**
 * Registers the fields the active SEO plugin does not already accept writes for.
 *
 * Rank Math and All in One SEO both already write their SEO meta through the
 * REST API on their own (Rank Math's /rankmath/v1/updateMeta route; All in One
 * SEO's aioseo_meta_data field on the core endpoints), so nothing is registered
 * for them. For Yoast SEO the fields below are the gap: canonical addresses and
 * the hide-from-search setting are read-only over REST, and the search
 * description is writable only for the post post type (Yoast's own REST
 * registration, which is left untouched).
 *
 * @return void
 */
function tinystudio_connector_register_seo_fields() {
	if ( 'yoast' !== tinystudio_connector_active_seo_plugin() ) {
		return;
	}

	foreach ( tinystudio_connector_supported_post_types() as $post_type ) {
		tinystudio_connector_register_fields_for_post_type( $post_type );
	}
}

/**
 * Registers the connector's fields for one post type.
 *
 * Rejection happens at the REST schema layer (WordPress validates registered
 * meta against its schema before any write), because a registered meta
 * sanitize_callback cannot refuse a value on its own: whatever it returns is
 * stored. The sanitize callbacks below therefore mirror what Yoast's own
 * sanitizer does with the same values, as a second line of defense for writes
 * that do not come through the REST API.
 *
 * @param string $post_type Post type name.
 * @return void
 */
function tinystudio_connector_register_fields_for_post_type( $post_type ) {
	// Preferred address. The REST schema rejects anything that is not an
	// absolute http(s) address; wp_http_validate_url doubles the check for
	// writes that do not come through the REST API.
	register_post_meta(
		$post_type,
		'_yoast_wpseo_canonical',
		array(
			'type'              => 'string',
			'single'            => true,
			'auth_callback'     => 'tinystudio_connector_can_edit_post',
			'sanitize_callback' => 'tinystudio_connector_sanitize_canonical',
			'show_in_rest'      => array(
				'schema' => array(
					'type'    => 'string',
					'format'  => 'uri',
					'pattern' => '^https?://\S+$',
				),
			),
		)
	);

	// Hide from search. Yoast's own values for this setting: 0 is the post type
	// default, 1 is noindex and 2 is index. The REST schema rejects anything
	// else; the sanitize callback keeps the same rule for other write paths.
	register_post_meta(
		$post_type,
		'_yoast_wpseo_meta-robots-noindex',
		array(
			'type'              => 'string',
			'single'            => true,
			'auth_callback'     => 'tinystudio_connector_can_edit_post',
			'sanitize_callback' => 'tinystudio_connector_sanitize_noindex',
			'show_in_rest'      => array(
				'schema' => array(
					'type' => 'string',
					'enum' => array( '0', '1', '2' ),
				),
			),
		)
	);

	// Search description. Yoast already registers this field for the post post
	// type with show_in_rest and its own auth and sanitize callbacks, so it is
	// left exactly as Yoast registered it there; re-registering would replace
	// Yoast's callbacks. Everywhere else Yoast still keeps the field read-only,
	// and the connector opens it up.
	if ( ! tinystudio_connector_meta_is_rest_exposed( '_yoast_wpseo_metadesc', $post_type ) ) {
		register_post_meta(
			$post_type,
			'_yoast_wpseo_metadesc',
			array(
				'type'              => 'string',
				'single'            => true,
				'auth_callback'     => 'tinystudio_connector_can_edit_post',
				'sanitize_callback' => 'tinystudio_connector_sanitize_meta_description',
				'show_in_rest'      => array(
					'schema' => array(
						'type'      => 'string',
						'maxLength' => 1000,
					),
				),
			)
		);
	}
}

/**
 * Reports whether a meta key is already registered for REST writes on a post type.
 *
 * @param string $meta_key  Meta key.
 * @param string $post_type Post type name.
 * @return bool True when the key is registered with show_in_rest for the type.
 */
function tinystudio_connector_meta_is_rest_exposed( $meta_key, $post_type ) {
	$args = get_registered_meta_keys( 'post', $post_type );

	if ( empty( $args[ $meta_key ]['show_in_rest'] ) ) {
		return false;
	}

	return true;
}

/**
 * Authorizes a field write only for users who may edit the post itself.
 *
 * Wired as the auth_callback of every field the connector registers.
 *
 * @param bool   $allowed   Whether the user is allowed by default.
 * @param string $meta_key  The meta key.
 * @param int    $object_id The post ID.
 * @return bool True only when the user can edit the post.
 */
function tinystudio_connector_can_edit_post( $allowed, $meta_key, $object_id ) {
	return (bool) current_user_can( 'edit_post', (int) $object_id );
}

/**
 * Sanitizes a search description the way Yoast's own sanitizer does.
 *
 * Tags and scripts are stripped rather than stored. Registered as the
 * sanitize_callback of the search description field.
 *
 * @param mixed  $meta_value     Incoming value.
 * @param string $meta_key       The meta key.
 * @param string $object_type    Object type.
 * @param string $object_subtype Object subtype.
 * @return string The sanitized description.
 */
function tinystudio_connector_sanitize_meta_description( $meta_value, $meta_key, $object_type, $object_subtype ) {
	if ( ! is_string( $meta_value ) ) {
		return '';
	}

	return sanitize_text_field( $meta_value );
}

/**
 * Validates and sanitizes a preferred address.
 *
 * Anything that is not an absolute http(s) address is dropped to an empty
 * string, so a bad value never reaches the page's head. Registered as the
 * sanitize_callback of the preferred address field.
 *
 * @param mixed  $meta_value     Incoming value.
 * @param string $meta_key       The meta key.
 * @param string $object_type    Object type.
 * @param string $object_subtype Object subtype.
 * @return string The sanitized address, or an empty string when invalid.
 */
function tinystudio_connector_sanitize_canonical( $meta_value, $meta_key, $object_type, $object_subtype ) {
	if ( ! is_string( $meta_value ) || false === wp_http_validate_url( $meta_value ) ) {
		return '';
	}

	return esc_url_raw( $meta_value );
}

/**
 * Keeps only the values Yoast itself uses for the hide-from-search setting.
 *
 * Anything else is dropped to an empty string. Registered as the
 * sanitize_callback of the hide-from-search field.
 *
 * @param mixed  $meta_value     Incoming value.
 * @param string $meta_key       The meta key.
 * @param string $object_type    Object type.
 * @param string $object_subtype Object subtype.
 * @return string The known value, or an empty string when unknown.
 */
function tinystudio_connector_sanitize_noindex( $meta_value, $meta_key, $object_type, $object_subtype ) {
	if ( ! in_array( (string) $meta_value, array( '0', '1', '2' ), true ) ) {
		return '';
	}

	return (string) $meta_value;
}
