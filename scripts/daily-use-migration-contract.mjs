// Exact logical transitions and fixed target-function metadata, derived on disposable PG17.
export const dailyUseContract = Object.freeze({
  "schema": 1,
  "prerequisiteVersions": [
    "20261021013525",
    "20261021014030",
    "20261021021732",
    "20261021023748",
    "20261021025224",
    "20261021104211",
    "20261021104534",
    "20261021105224",
    "20261021105734",
    "20261021111453",
    "20261021111858",
    "20261022220119",
    "20261022221123",
    "20261022221400",
    "20261022235056",
    "20261022235532",
    "20261023000813",
    "20261024001046",
    "20261024001118",
    "20261024194042",
    "20261024195307",
    "20261024202950",
    "20261025001519",
    "20261025184542",
    "20261025195400",
    "20261025220548",
    "20261026223029",
    "20261027000338",
    "20261027020041",
    "20261027030132",
    "20261027100851",
    "20261027165035",
    "20261027234400",
    "20261028023000",
    "20261028024500",
    "20261028130000",
    "20261028233915",
    "20261029015509",
    "20261029022238",
    "20261029123923",
    "20261031002750",
    "20261031002813",
    "20261031002826",
    "20261031003121",
    "20261031005641",
    "20261031013730",
    "20261104090000",
    "20261104095658",
    "20261104110432",
    "20261104115513",
    "20261105011050",
    "20261107194452",
    "20261107200416",
    "20261107203128",
    "20261107204220",
    "20261107205636",
    "20261107224727"
  ],
  "sources": [
    {
      "file": "20261111023125_social_collection_failure_backoff.sql",
      "version": "20261111023125",
      "name": "social_collection_failure_backoff",
      "sourceSha256": "5b62b5d4df29be8253d38c00f2c41c9c6ba1229ff204d7be620676327996b393",
      "bodySha256": "fcb66b273faee50d732dba2c3fcbc5246928219b65d24c220a92c4f51a12f440"
    },
    {
      "file": "20261111023748_renewed_finite_analysis_allowance.sql",
      "version": "20261111023748",
      "name": "renewed_finite_analysis_allowance",
      "sourceSha256": "a7582a59452e0d396207602d045052a43fd1fa7d48651daec7fedd5a49bb77f0",
      "bodySha256": "3ee2a7648782a2e639aad1f2039a41260af335aeac22fcf9bb973477f8d0dda9"
    }
  ],
  "changes": [
    {
      "key": "column:public.social_job_retry_history.finished_at",
      "beforeSha256": null,
      "afterSha256": "32459c1b1863d77a7471472d7eed2435802e5f1853f93cca168ef7ca0bf2fa31"
    },
    {
      "key": "column:public.social_job_retry_history.id",
      "beforeSha256": null,
      "afterSha256": "60194f64989b817d0f9c6ed829c1e1547e1d8147456822b7c8e48ef401745bc2"
    },
    {
      "key": "column:public.social_job_retry_history.source_key",
      "beforeSha256": null,
      "afterSha256": "993b04ff78b1e9baddaea49811cd13e8565804c22c31da122a788f9b7f59948e"
    },
    {
      "key": "definition:claim_automatic_content_task(integer)",
      "beforeSha256": "69d9178aa497daaba9810a58c5aedcf52e3a5e00885041af86ad4d80f1881489",
      "afterSha256": "4dd9e146cdcf43752333e579a31f428952a1aa6d43d3d668658256efa9b4f6a3"
    },
    {
      "key": "definition:claim_social_content_task(integer)",
      "beforeSha256": "04d071614f3e94bfbe0089bd643d004932c894160e3e563316478b0b0feeed07",
      "afterSha256": "5154a384ccaddcc40118c54c4bb3cc8de16792e9858457ab62c18197f3b91079"
    },
    {
      "key": "definition:finish_social_collection_job(uuid,uuid,jsonb,jsonb,numeric,boolean,text)",
      "beforeSha256": "ccdeb7defeb0ec5c95bdec78154d97e010c9bb195ea5bfcafd660e63ab441336",
      "afterSha256": "c340422afd7c9dc60970a492eb194d07d31467d6fccf7ad9d41e003c528a566a"
    },
    {
      "key": "definition:reserve_keyword_learning_call(uuid,text,integer,text,text,jsonb,text,numeric,jsonb)",
      "beforeSha256": "89f9b6c4684925848ba16edb70a4d3c682a0e240c08085d55f1ba929a8a2d7fb",
      "afterSha256": "64ed84925d8b604b3b6e4bfd2b387ec08d0f12a31371964cb2abb1c95bee6df1"
    },
    {
      "key": "definition:social_collection_retry_delay(text,uuid,boolean,text)",
      "beforeSha256": null,
      "afterSha256": "ab1648561819745b21124b2b41bc15a56c74a05d40c5e25255b34ec3efa0b270"
    },
    {
      "key": "function:claim_automatic_content_task(integer)",
      "beforeSha256": "28e81e046329787785980b49a0b803508d2e3b6bb37b59e198ba4ab434fac827",
      "afterSha256": "28e81e046329787785980b49a0b803508d2e3b6bb37b59e198ba4ab434fac827"
    },
    {
      "key": "function:claim_social_content_task(integer)",
      "beforeSha256": "28e81e046329787785980b49a0b803508d2e3b6bb37b59e198ba4ab434fac827",
      "afterSha256": "28e81e046329787785980b49a0b803508d2e3b6bb37b59e198ba4ab434fac827"
    },
    {
      "key": "function:finish_social_collection_job(uuid,uuid,jsonb,jsonb,numeric,boolean,text)",
      "beforeSha256": "fe3127f126c436632920cf2a57f8e6f1c3d82c482fa0f387b8a60e1ad0f8b4f3",
      "afterSha256": "fe3127f126c436632920cf2a57f8e6f1c3d82c482fa0f387b8a60e1ad0f8b4f3"
    },
    {
      "key": "function:reserve_keyword_learning_call(uuid,text,integer,text,text,jsonb,text,numeric,jsonb)",
      "beforeSha256": "a2e5e2a193627941004eebdd6df82f9c7b69f57a66a4ad7728560babf8c7ac69",
      "afterSha256": "a2e5e2a193627941004eebdd6df82f9c7b69f57a66a4ad7728560babf8c7ac69"
    },
    {
      "key": "function:social_collection_retry_delay(text,uuid,boolean,text)",
      "beforeSha256": null,
      "afterSha256": "2f097d6321cefc990fe2ec88f65e9f1cd22502a045b6377f5353c8340b690a1c"
    },
    {
      "key": "index:public.social_job_retry_history",
      "beforeSha256": null,
      "afterSha256": "f021199424b1b7bec1532e5260b281ead7d3dc1249efde43755b5fbfef917da0"
    },
    {
      "key": "relation:public.social_job_retry_history",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477"
    }
  ]
});
