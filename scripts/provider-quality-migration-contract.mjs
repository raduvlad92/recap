// Exact new stage migration and unchanged financial ACL metadata, derived on disposable PG17.
export const providerQualityContract = Object.freeze({
  "schema": 1,
  "servingCommit": "1947636523f415461f0cee0f78ad758f77ed49f6",
  "acceptedPredecessorObjectsSha256": "a429fac628ade28814c403ace7dd9623a27598c266b71844e1aa4649ea743870",
  "acceptedPredecessorHistorySha256": "fceed4113e55569a4933d7cc9740ba71cd827a7a4798dd31d665cca880df3f55",
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
    "20261107224727",
    "20261111023125",
    "20261111023748"
  ],
  "sources": [
    {
      "file": "20261111211058_provider_metadata_stages.sql",
      "version": "20261111211058",
      "name": "provider_metadata_stages",
      "sourceSha256": "e89215c1d628a41f0f99059650f22e9b82796744ac8698a553839b004a03c1d4",
      "bodySha256": "17435baf610690848fed7c5700a46c36f7e604f25fa681645a3ee6b76c235ae8"
    }
  ],
  "changes": [
    {
      "key": "constraint:public.collection_retrieval_attempts.collection_retrieval_attempts_item_key_check",
      "beforeSha256": "9996ad481d7fe033d97c2285528be4a43f6f51b83d5ec045bd13540810522971",
      "afterSha256": "eafcff1b1876fce2526febeeadfd36b1bdb0f10cae4e74635e039beb202bbb6c",
      "allowIdentityChange": true
    },
    {
      "key": "definition:finish_hourly_source(uuid,uuid,jsonb,jsonb)",
      "beforeSha256": "bc8d45cc24d9f26c9755217e74d2d69091559e531b6f04a67718fb98da4f4f44",
      "afterSha256": "dcbd1366fe1777b1af8a446e57e5ef367f1c120d740cae5c3cdcc975344478c8"
    },
    {
      "key": "definition:merge_hourly_video_enrichment(jsonb,jsonb)",
      "beforeSha256": "ec6062a643ea6c18e9ab4de1b5bc0acff61100b65a958e379f98fa29e21e629f",
      "afterSha256": "48b1a0c3a7264c863da05f1eaa66db5cf95a08e1635f00a21f8dadc06766aa92"
    },
    {
      "key": "definition:pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)",
      "beforeSha256": null,
      "afterSha256": "feb042db0125c84bdda9d1f5abf90f04e0a848be33d27a793d077dbe0fc66d6d"
    },
    {
      "key": "definition:prepare_late_provider_fee(uuid)",
      "beforeSha256": "7598f120afcabb92e633fd735f7d8012db66fa78eda64031144259e5572c1024",
      "afterSha256": "f206f28bcdb412a2e90e3cbe9f370af87641e3afd1c25627c232dfb55502f1a9"
    },
    {
      "key": "definition:reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": "390a0b43badd139a49893f2dfab44aaf8fd04775f318ddd7147d37afc71e1dc9",
      "afterSha256": "529bfdab94f3d54e3bc94f7b0db262beac5f5efd6a07c74cb026f5cdf1035bd6"
    },
    {
      "key": "function:pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)",
      "beforeSha256": null,
      "afterSha256": "1b4a83701da3067cefee90b43da282c27406292d711451b1bbf41529498b65cf"
    },
    {
      "key": "function:reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": "181b71b37d63ca9514b4e60a9cfed1979d3827e5f786ee00ffffb29b481e7c4e",
      "afterSha256": "181b71b37d63ca9514b4e60a9cfed1979d3827e5f786ee00ffffb29b481e7c4e"
    },
    {
      "key": "function:prepare_late_provider_fee(uuid)",
      "beforeSha256": "149920895d4becde4422d5d92760603339104c4b42f9baae874ba30230f1d42b",
      "afterSha256": "149920895d4becde4422d5d92760603339104c4b42f9baae874ba30230f1d42b"
    },
    {
      "key": "function:merge_hourly_video_enrichment(jsonb,jsonb)",
      "beforeSha256": "1a58dae58f0f1b091306601b47e90fe0844aa65da84f255ebae625d0d539aaee",
      "afterSha256": "1a58dae58f0f1b091306601b47e90fe0844aa65da84f255ebae625d0d539aaee"
    },
    {
      "key": "function:finish_hourly_source(uuid,uuid,jsonb,jsonb)",
      "beforeSha256": "7c05477433303bfbe9eb262a72ece6aa442448a1a3a7ea96b3b877ad37d431cd",
      "afterSha256": "7c05477433303bfbe9eb262a72ece6aa442448a1a3a7ea96b3b877ad37d431cd"
    }
  ]
});
