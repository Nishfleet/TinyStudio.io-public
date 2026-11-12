<?php
/**
 * Rank Math tests: the connector registers nothing, and Rank Math's own REST
 * write path works without it.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tests the connector against Rank Math.
 */
final class Tinystudio_Connector_Rank_Math_Test extends Tinystudio_Connector_TestCase {

	/**
	 * Fails early unless the suite runs against Rank Math.
	 *
	 * @return void
	 */
	protected function set_up(): void {
		parent::set_up();
		$this->assert_detected_seo_plugin( 'rank-math' );
	}

	/**
	 * Rank Math already accepts SEO writes through its own REST route, so the
	 * connector registers nothing for it.
	 *
	 * @return void
	 */
	public function test_connector_registers_nothing_for_rank_math(): void {
		foreach ( tinystudio_connector_supported_post_types() as $post_type ) {
			$this->assertSame(
				array(),
				tinystudio_connector_registered_fields( $post_type ),
				"The connector must not register Yoast fields for {$post_type}."
			);
		}

		$args = get_registered_meta_keys( 'post', 'page' );
		$this->assertArrayNotHasKey( '_yoast_wpseo_canonical', $args );
		$this->assertArrayNotHasKey( '_yoast_wpseo_meta-robots-noindex', $args );
		$this->assertArrayNotHasKey( '_yoast_wpseo_metadesc', $args );
	}

	/**
	 * An Editor with an application password writes a page's title,
	 * description and hide-from-search through Rank Math's own REST route, and
	 * the rendered head then shows the new values.
	 *
	 * @return void
	 */
	public function test_rank_math_writes_a_pages_seo_fields_through_its_own_route(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'POST',
			'/rankmath/v1/updateMeta',
			array(
				'objectType' => 'post',
				'objectID'   => $page_id,
				'meta'       => array(
					'rank_math_title'       => 'TinyStudio repaired this page title',
					'rank_math_description' => 'TinyStudio repaired this page description.',
					'rank_math_robots'      => array( 'noindex' ),
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'TinyStudio repaired this page title', get_post_meta( $page_id, 'rank_math_title', true ) );
		$this->assertSame( 'TinyStudio repaired this page description.', get_post_meta( $page_id, 'rank_math_description', true ) );

		$head = $this->rendered_head( get_permalink( $page_id ) );
		$this->assertStringContainsString( 'TinyStudio repaired this page title', $head );
		$this->assertStringContainsString( 'TinyStudio repaired this page description.', $head );
		$this->assertStringContainsString( 'noindex', $head );
	}

	/**
	 * A Subscriber with an application password is refused by Rank Math's own
	 * route.
	 *
	 * @return void
	 */
	public function test_subscriber_is_refused(): void {
		list( , $authorization ) = $this->subscriber_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'POST',
			'/rankmath/v1/updateMeta',
			array(
				'objectType' => 'post',
				'objectID'   => $page_id,
				'meta'       => array(
					'rank_math_description' => 'TinyStudio repaired this page description.',
				),
			),
			$authorization
		);

		$this->assertGreaterThanOrEqual( 400, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, 'rank_math_description', true ) );
	}
}
